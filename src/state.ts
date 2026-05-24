import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = join(__dirname, "..", "state");

export type CartLine = { dishId: string; qty: number };

export type MenuItem = {
  emoji: string;
  dishId: string;
  name: string;
  price: number;
  description?: string;
};

export type FoodyState = {
  user: string;
  address: string | null;
  activeRestaurantId: string | null;
  activeRestaurantName: string | null;
  menu: MenuItem[];
  cart: CartLine[];
  lastOrderId: string | null;
  updatedAt: string;
};

function emptyState(user: string): FoodyState {
  return {
    user,
    address: null,
    activeRestaurantId: null,
    activeRestaurantName: null,
    menu: [],
    cart: [],
    lastOrderId: null,
    updatedAt: new Date().toISOString(),
  };
}

function safeUserKey(user: string): string {
  return user.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function statePath(user: string): string {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
  return join(STATE_DIR, `${safeUserKey(user)}.json`);
}

export function loadState(user: string): FoodyState {
  const path = statePath(user);
  if (!existsSync(path)) return emptyState(user);
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as FoodyState;
  } catch {
    return emptyState(user);
  }
}

export function saveState(state: FoodyState): void {
  state.updatedAt = new Date().toISOString();
  writeFileSync(statePath(state.user), JSON.stringify(state, null, 2));
}

export function resetState(user: string): FoodyState {
  const fresh = emptyState(user);
  saveState(fresh);
  return fresh;
}
