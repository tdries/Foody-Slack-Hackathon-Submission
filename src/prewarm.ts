/**
 * Daily background prewarm of the disk cache so that "second-experience" is
 * instant for known addresses. For each saved address (state/addr_*.json):
 *   1. Refresh restaurant listings per category.
 *   2. For each top restaurant, fetch its menu.
 *
 * Designed to be fire-and-forget: errors are logged and never thrown, so it
 * can't take down the Slack listener. A simple in-process lock prevents two
 * runs from overlapping.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CATEGORIES } from "./categories.ts";
import { findRestaurants, getTopDishes, LIVE_RESTAURANT_ID_PREFIX } from "./takeaway.ts";
import { cacheSweepExpired } from "./disk-cache.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = join(__dirname, "..", "state");

let running = false;

function savedAddresses(): string[] {
  if (!existsSync(STATE_DIR)) return [];
  const addrs = new Set<string>();
  for (const name of readdirSync(STATE_DIR)) {
    if (!name.startsWith("addr_") || !name.endsWith(".json")) continue;
    try {
      const data = JSON.parse(readFileSync(join(STATE_DIR, name), "utf-8")) as {
        address?: string | null;
      };
      if (data.address && typeof data.address === "string") {
        addrs.add(data.address.trim());
      }
    } catch {
      // skip corrupt files
    }
  }
  return [...addrs];
}

/** Runs the prewarm pass once. Safe to call concurrently — re-entry is a no-op. */
export async function runPrewarm(): Promise<void> {
  if (running) {
    console.log("[prewarm] skipping — already running");
    return;
  }
  running = true;
  const start = Date.now();
  try {
    const swept = cacheSweepExpired();
    if (swept > 0) console.log(`[prewarm] swept ${swept} expired cache entries`);

    const addresses = savedAddresses();
    if (addresses.length === 0) {
      console.log("[prewarm] no saved addresses — nothing to warm");
      return;
    }
    console.log(`[prewarm] starting · ${addresses.length} address(es) · ${CATEGORIES.length} categories`);

    for (const address of addresses) {
      for (const cat of CATEGORIES) {
        try {
          const restaurants = await findRestaurants(address, 3, cat.id);
          // Warm only the top restaurant per category — keeps the pass short
          // while still giving the user instant menus for the most likely pick.
          const top = restaurants[0];
          if (top && top.id.startsWith(LIVE_RESTAURANT_ID_PREFIX)) {
            await getTopDishes(top.id, 10);
          }
        } catch (err: any) {
          console.warn(`[prewarm] ${address} / ${cat.id} failed: ${err?.message ?? err}`);
        }
      }
    }
    console.log(`[prewarm] done in ${Math.round((Date.now() - start) / 1000)}s`);
  } finally {
    running = false;
  }
}

/**
 * Kicks off an immediate prewarm (after a short delay so app boot finishes
 * first) and re-runs every 24h. Returns the interval handle so callers can
 * clearInterval(it) on shutdown if needed.
 */
export function schedulePrewarm(): NodeJS.Timeout {
  // Don't block boot; start the first pass in 8s so Slack is online first.
  setTimeout(() => {
    void runPrewarm();
  }, 8000);
  return setInterval(() => {
    void runPrewarm();
  }, 24 * 60 * 60 * 1000);
}
