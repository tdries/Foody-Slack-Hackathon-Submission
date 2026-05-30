/**
 * Tiny disk-backed TTL cache used to make the "second-experience" instant.
 * Live takeaway.com scrapes (per-address restaurant listings, per-restaurant
 * menus) are expensive (10-15s warmup + scrape), so we persist them at
 * `state/cache/<sha1>.json` with a 24h TTL and refresh in the background.
 *
 * Layout: one file per cache key. File content:
 *   { key, value, expiresAt }   // expiresAt is a unix ms timestamp
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, "..", "state", "cache");

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function ensureDir(): void {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

function pathFor(key: string): string {
  ensureDir();
  const slug = createHash("sha1").update(key).digest("hex").slice(0, 24);
  return join(CACHE_DIR, `${slug}.json`);
}

export function cacheGet<T>(key: string): T | null {
  const path = pathFor(key);
  if (!existsSync(path)) return null;
  try {
    const entry = JSON.parse(readFileSync(path, "utf-8")) as {
      key: string;
      value: T;
      expiresAt: number;
    };
    if (entry.expiresAt < Date.now()) return null;
    return entry.value;
  } catch {
    return null;
  }
}

export function cacheSet<T>(key: string, value: T, ttlMs = DEFAULT_TTL_MS): void {
  const path = pathFor(key);
  try {
    writeFileSync(
      path,
      JSON.stringify({ key, value, expiresAt: Date.now() + ttlMs }, null, 0),
    );
  } catch (err) {
    console.warn(`[cache] write failed for "${key}":`, err);
  }
}

/** Removes any cache files whose TTL has expired. Safe to call periodically. */
export function cacheSweepExpired(): number {
  if (!existsSync(CACHE_DIR)) return 0;
  let removed = 0;
  for (const name of readdirSync(CACHE_DIR)) {
    if (!name.endsWith(".json")) continue;
    const p = join(CACHE_DIR, name);
    try {
      const entry = JSON.parse(readFileSync(p, "utf-8")) as { expiresAt?: number };
      if (typeof entry.expiresAt === "number" && entry.expiresAt < Date.now()) {
        unlinkSync(p);
        removed += 1;
      }
    } catch {
      // Corrupt entry — wipe.
      try {
        unlinkSync(p);
        removed += 1;
      } catch {
        // ignore
      }
    }
  }
  return removed;
}
