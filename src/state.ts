import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = join(__dirname, "..", "state");

import { slackNameForUnicode } from "./emojis.ts";

export type CartLine = { dishId: string; qty: number };

export type MenuItem = {
  emoji: { unicode: string; slack: string };
  dishId: string;
  name: string;
  price: number;
  description?: string;
};

/** What the bot is waiting on next in this conversation, if anything. */
export type PendingPrompt = "address" | null;

export type FoodyState = {
  user: string;
  address: string | null;
  activeRestaurantId: string | null;
  activeRestaurantName: string | null;
  menu: MenuItem[];
  cart: CartLine[];
  lastOrderId: string | null;
  /** Slack userId that started this session — used to look up the address book. */
  initiator: string | null;
  pendingPrompt: PendingPrompt;
  /** The Slack ts of the menu message we pre-reacted to, so reaction events can be matched to the right session. */
  menuMessageTs: string | null;
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
    initiator: null,
    pendingPrompt: null,
    menuMessageTs: null,
    updatedAt: new Date().toISOString(),
  };
}

/** Backfill optional fields when loading a state file written by an older version. */
function normalise(s: FoodyState): FoodyState {
  const merged: FoodyState = { ...emptyState(s.user), ...s };
  // Old menu items had `emoji: string` (just the Unicode). Hoist to the new shape.
  merged.menu = (merged.menu ?? []).map((m: any) => {
    if (m && typeof m.emoji === "string") {
      const slack = slackNameForUnicode(m.emoji) ?? "question";
      return { ...m, emoji: { unicode: m.emoji, slack } };
    }
    return m as MenuItem;
  });
  return merged;
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
