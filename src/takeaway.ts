import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const MANIFEST_PATH = join(DATA_DIR, "dish-images", "manifest.json");
const UPLOADED_PATH = join(DATA_DIR, "dish-images", "uploaded.json");

type ManifestEntry = { slug: string; source: string };
type Manifest = Record<string, ManifestEntry>;
type Uploaded = Record<string, boolean>;

function loadManifest(): Manifest {
  if (!existsSync(MANIFEST_PATH)) return {};
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, "utf-8")) as Manifest;
  } catch {
    return {};
  }
}

function loadUploaded(): Uploaded {
  if (!existsSync(UPLOADED_PATH)) return {};
  try {
    return JSON.parse(readFileSync(UPLOADED_PATH, "utf-8")) as Uploaded;
  } catch {
    return {};
  }
}

/** Prefix used by scrape-live.ts to namespace live-scraped restaurant ids. */
export const LIVE_RESTAURANT_ID_PREFIX = "rest-live-";

export type Restaurant = {
  id: string;
  name: string;
  cuisine: string;
  rating: number; // 0-5
  reviewCount: number;
  deliveryTimeMin: number;
  deliveryFee: number;
  minOrder: number;
  postcodes: string[]; // postcodes this restaurant serves
  /** If set, this is a real takeaway.com restaurant; Foody will drive a real cart-build on Order. */
  takeawayUrl?: string;
  /** Set true on restaurants scraped from takeaway.com (vs mock). */
  isReal?: boolean;
};

export type Dish = {
  id: string;
  restaurantId: string;
  name: string;
  description: string;
  price: number;
  popularity: number; // 0-100, used to rank "top 10"
  category?: string;
  /** Ordered preference list of Slack emoji shortcodes (no colons) for menu rendering. The first non-colliding one wins in assignUniqueEmojis. */
  slackEmojiPrefs?: string[];
  /** Workspace-uploaded custom emoji shortcode (no colons), e.g. "foody_margherita". */
  customEmoji?: string;
  /** Numeric takeaway.com dish id (from the Cloudinary URL) for real restaurants. */
  takeawayDishId?: string | null;
  /** Exact name string as it appears on takeaway.com, for DOM matching at cart-build time. */
  takeawayDishName?: string;
};

type DataFile = {
  restaurants: Restaurant[];
  dishes: Dish[];
};

let cache: DataFile | null = null;

function loadData(): DataFile {
  if (cache) return cache;
  const mockPath = join(DATA_DIR, "takeaway-mock.json");
  const realPath = join(DATA_DIR, "takeaway-real.json");

  const mock = JSON.parse(readFileSync(mockPath, "utf-8")) as DataFile;
  const real: DataFile = existsSync(realPath)
    ? (JSON.parse(readFileSync(realPath, "utf-8")) as DataFile)
    : { restaurants: [], dishes: [] };

  // Concatenate. Real and mock IDs are namespaced ("rest-real-*" vs "rest-NNN")
  // so they never collide. Real restaurants get a slight rating bump in the
  // listing — Foody's user-facing menus should preference the real data.
  const merged: DataFile = {
    restaurants: [...real.restaurants, ...mock.restaurants],
    dishes: [...real.dishes, ...mock.dishes],
  };

  const manifest = loadManifest();
  const uploaded = loadUploaded();
  for (const d of merged.dishes) {
    const entry = manifest[d.id];
    if (entry && uploaded[entry.slug]) d.customEmoji = `foody_${entry.slug}`;
  }

  cache = merged;
  return cache;
}

function postcodeFromAddress(address: string): string | null {
  const m = address.match(/\b(\d{4})\b/);
  return m ? m[1] : null;
}

/**
 * Live takeaway.com integration. Per-address listings and per-restaurant menus
 * are scraped on demand via a long-lived headless puppeteer in scrape-live.ts
 * and cached in-process. Any failure (Chrome won't launch, DOM changed, address
 * not recognized) falls back silently to the static mock+real-static data so
 * the bot never hangs.
 */
const liveListingsCache = new Map<string, Restaurant[]>();
const liveMenuCache = new Map<string, Dish[]>();
const liveDishById = new Map<string, Dish>();

/** Has live scraping been disabled (e.g. via FOODY_DISABLE_LIVE=1) ? */
const LIVE_DISABLED = process.env.FOODY_DISABLE_LIVE === "1";

import { cacheGet, cacheSet } from "./disk-cache.ts";

function listingsCacheKey(address: string, categoryId: string | null): string {
  return `listings::${address.trim().toLowerCase()}::${categoryId ?? ""}`;
}

function menuCacheKey(restaurantId: string): string {
  return `menu::${restaurantId}`;
}

/** Hydrate in-memory caches from disk on first use so a fresh process starts warm. */
function hydrateListingsFromDisk(address: string, categoryId: string | null): Restaurant[] | null {
  const key = listingsCacheKey(address, categoryId);
  const disk = cacheGet<Restaurant[]>(key);
  if (!disk) return null;
  liveListingsCache.set(`${address}::${categoryId ?? ""}`, disk);
  return disk;
}

async function fetchLive(address: string, categoryId: string | null): Promise<Restaurant[] | null> {
  if (LIVE_DISABLED) return null;
  const memKey = `${address}::${categoryId ?? ""}`;
  const cached = liveListingsCache.get(memKey) ?? hydrateListingsFromDisk(address, categoryId);
  if (cached) return cached;
  try {
    const { scrapeListings } = await import("./scrape-live.ts");
    const restaurants = await scrapeListings(address, 3, categoryId);
    if (restaurants.length === 0) return null;
    liveListingsCache.set(memKey, restaurants);
    cacheSet(listingsCacheKey(address, categoryId), restaurants);
    return restaurants;
  } catch (err: any) {
    console.warn(`[takeaway] live listings scrape failed for "${address}": ${err?.message ?? err}`);
    return null;
  }
}

export async function findRestaurants(
  address: string,
  limit = 3,
  categoryId: string | null = null,
): Promise<Restaurant[]> {
  const live = await fetchLive(address, categoryId);
  if (live && live.length > 0) return live.slice(0, limit);

  // Fallback: static data. Real restaurants get a slight surfacing bump so the
  // hand-curated entries win over equal-rated mocks. Category filter (if set)
  // is applied against the cuisine field of the static entries.
  const data = loadData();
  const pc = postcodeFromAddress(address);
  let candidates = data.restaurants;
  if (pc) {
    const matched = candidates.filter((r) => r.postcodes.includes(pc));
    if (matched.length > 0) candidates = matched;
  }
  if (categoryId) {
    const { categoryById } = await import("./categories.ts");
    const cat = categoryById(categoryId);
    if (cat) {
      const matched = candidates.filter((r) => cat.match.test(`${r.name} ${r.cuisine}`));
      if (matched.length > 0) candidates = matched;
    }
  }
  return [...candidates]
    .sort((a, b) => {
      const realBias = (b.takeawayUrl ? 0.5 : 0) - (a.takeawayUrl ? 0.5 : 0);
      return b.rating - a.rating + realBias || b.reviewCount - a.reviewCount;
    })
    .slice(0, limit);
}

export async function getRestaurant(id: string): Promise<Restaurant | null> {
  // Live cache first — listings scraped for any address might hold this id.
  for (const list of liveListingsCache.values()) {
    const r = list.find((r) => r.id === id);
    if (r) return r;
  }
  const data = loadData();
  return data.restaurants.find((r) => r.id === id) ?? null;
}

export async function getTopDishes(restaurantId: string, limit = 10): Promise<Dish[]> {
  const cached = liveMenuCache.get(restaurantId) ?? cacheGet<Dish[]>(menuCacheKey(restaurantId));
  if (cached) {
    liveMenuCache.set(restaurantId, cached);
    for (const d of cached) liveDishById.set(d.id, d);
    return cached.slice(0, limit);
  }

  // Live restaurants — scrape the menu on first lookup, then cache.
  const restaurant = await getRestaurant(restaurantId);
  if (!LIVE_DISABLED && restaurant?.takeawayUrl && restaurantId.startsWith(LIVE_RESTAURANT_ID_PREFIX)) {
    try {
      const { scrapeMenu } = await import("./scrape-live.ts");
      const dishes = await scrapeMenu(restaurant.takeawayUrl, restaurantId, limit);
      if (dishes.length > 0) {
        liveMenuCache.set(restaurantId, dishes);
        for (const d of dishes) liveDishById.set(d.id, d);
        cacheSet(menuCacheKey(restaurantId), dishes);
        return dishes;
      }
    } catch (err: any) {
      console.warn(
        `[takeaway] live menu scrape failed for ${restaurantId}: ${err?.message ?? err}`,
      );
    }
  }

  const data = loadData();
  return data.dishes
    .filter((d) => d.restaurantId === restaurantId)
    .sort((a, b) => b.popularity - a.popularity)
    .slice(0, limit);
}

export async function getDish(dishId: string): Promise<Dish | null> {
  const live = liveDishById.get(dishId);
  if (live) return live;
  const data = loadData();
  return data.dishes.find((d) => d.id === dishId) ?? null;
}
