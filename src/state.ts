import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = join(__dirname, "..", "state");

import type { Restaurant } from "./takeaway.ts";

export type CartLine = { dishId: string; qty: number };

export type MenuItem = {
  emoji: { unicode: string; slack: string };
  dishId: string;
  name: string;
  price: number;
  description?: string;
  /** Exact takeaway.com dish name for DOM-matching at cart-build time, when this dish came from a real restaurant. */
  takeawayDishName?: string;
  /** Numeric takeaway.com dish id (parsed from /dishes/{id}/ in the image URL). Used to locate the row by image at cart-build time. */
  takeawayDishId?: string | null;
  /** Public CDN URL of the dish photo — powers the menu's photo view. */
  imageUrl?: string;
};

/** What the bot is waiting on next in this conversation, if anything. */
export type PendingPrompt = "address" | null;

export type FoodyState = {
  user: string;
  address: string | null;
  /** Cuisine category id chosen by the user (see src/categories.ts). Null until picked. */
  category: string | null;
  activeRestaurantId: string | null;
  activeRestaurantName: string | null;
  /** Full Restaurant snapshot saved when the user picks one. Self-contained so a bot restart between pick and order can still complete checkout (the live in-memory cache is wiped on restart). */
  activeRestaurant: Restaurant | null;
  /** The top-3 restaurants shown in the list, snapshotted so a pick still resolves after the in-memory live cache is wiped by a restart. */
  candidates: Restaurant[];
  menu: MenuItem[];
  cart: CartLine[];
  lastOrderId: string | null;
  /** Slack userId that started this session — used to look up the address book. */
  initiator: string | null;
  pendingPrompt: PendingPrompt;
  /** The Slack ts of the menu message we pre-reacted to, so reaction events can be matched to the right session. */
  menuMessageTs: string | null;
  /** The Slack ts of the restaurants-list message — recycled on cuisine re-pick so the thread doesn't grow one list per tap. */
  restaurantsMessageTs?: string | null;
  /** Menu render style, toggled by the order initiator. Grid = 2-column emoji list. */
  menuView?: "grid" | "photos";
  updatedAt: string;
};

function emptyState(user: string): FoodyState {
  return {
    user,
    address: null,
    category: null,
    activeRestaurantId: null,
    activeRestaurantName: null,
    activeRestaurant: null,
    candidates: [],
    menu: [],
    cart: [],
    lastOrderId: null,
    initiator: null,
    pendingPrompt: null,
    menuMessageTs: null,
    updatedAt: new Date().toISOString(),
  };
}

/** Backfill optional fields when loading a state file written by an older version. */
function normalise(s: FoodyState): FoodyState {
  return { ...emptyState(s.user), ...s };
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
    return normalise(JSON.parse(readFileSync(path, "utf-8")) as FoodyState);
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

/** State key for a user's sticky address book (one entry per Slack userId). */
export function addressKey(slackUserId: string): string {
  return `addr_${slackUserId}`;
}

/** State key for an active ordering session in a Slack thread. */
export function sessionKey(channel: string, threadTs: string): string {
  // Slack ts values contain a dot — replace it so the filename stays sane.
  return `sess_${channel}_${threadTs.replace(/\./g, "-")}`;
}

export function getDefaultAddress(slackUserId: string): string | null {
  return loadState(addressKey(slackUserId)).address;
}

export function setDefaultAddress(slackUserId: string, address: string): void {
  const state = loadState(addressKey(slackUserId));
  state.address = address;
  saveState(state);
}
