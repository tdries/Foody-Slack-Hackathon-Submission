import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");

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
};

export type Dish = {
  id: string;
  restaurantId: string;
  name: string;
  description: string;
  price: number;
  popularity: number; // 0-100, used to rank "top 10"
  category?: string;
};

type DataFile = {
  restaurants: Restaurant[];
  dishes: Dish[];
};

let cache: DataFile | null = null;

function loadData(): DataFile {
  if (cache) return cache;
  const path = join(DATA_DIR, "takeaway-mock.json");
  cache = JSON.parse(readFileSync(path, "utf-8")) as DataFile;
  return cache;
}

function postcodeFromAddress(address: string): string | null {
  const m = address.match(/\b(\d{4})\b/);
  return m ? m[1] : null;
}

/**
 * Live takeaway.com fetcher. Not yet wired up — takeaway.com has no public API
 * and rate-limits scrapers aggressively. To enable a real integration, replace
 * the body of this function with a fetch against the relevant endpoint and
 * return the same shape as the mock data.
 */
async function fetchLive(_address: string): Promise<DataFile | null> {
  return null;
}

export async function findRestaurants(address: string, limit = 3): Promise<Restaurant[]> {
  const live = await fetchLive(address);
  const data = live ?? loadData();
  const pc = postcodeFromAddress(address);

  let candidates = data.restaurants;
  if (pc) {
    const matched = candidates.filter((r) => r.postcodes.includes(pc));
    if (matched.length > 0) candidates = matched;
  }

  return [...candidates]
    .sort((a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount)
    .slice(0, limit);
}

export async function getRestaurant(id: string): Promise<Restaurant | null> {
  const data = loadData();
  return data.restaurants.find((r) => r.id === id) ?? null;
}

export async function getTopDishes(restaurantId: string, limit = 10): Promise<Dish[]> {
  const data = loadData();
  return data.dishes
    .filter((d) => d.restaurantId === restaurantId)
    .sort((a, b) => b.popularity - a.popularity)
    .slice(0, limit);
}

export async function getDish(dishId: string): Promise<Dish | null> {
  const data = loadData();
  return data.dishes.find((d) => d.id === dishId) ?? null;
}
