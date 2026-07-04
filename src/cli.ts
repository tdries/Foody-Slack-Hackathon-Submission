#!/usr/bin/env tsx
/**
 * foody CLI — the data + state layer that backs the Foody WhatsApp skill.
 *
 * All commands emit a single JSON object on stdout. The skill parses that JSON
 * and re-renders it as a WhatsApp-friendly message. Keeping presentation out of
 * the CLI lets the skill iterate on tone/format without touching code.
 */
import {
  loadState,
  saveState,
  resetState,
  type FoodyState,
  type MenuItem,
} from "./state.ts";
import {
  findRestaurants,
  getRestaurant,
  getTopDishes,
  getDish,
} from "./takeaway.ts";
import { assignUniqueEmojis } from "./emojis.ts";
import { emojiPrefsFor } from "./scrape-live.ts";

function matchMenuEmoji(input: string, menu: { emoji: { unicode: string } }[]): { unicode: string } | null {
  const target = input.replace(/️/g, "").trim();
  return menu.find((m) => m.emoji.unicode.replace(/️/g, "") === target)?.emoji ?? null;
}

type Args = { _: string[]; flags: Record<string, string | boolean> };

function parseArgs(argv: string[]): Args {
  const out: Args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        out.flags[key] = true;
      } else {
        out.flags[key] = next;
        i++;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function emit(payload: unknown): void {
  process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
}

function fail(message: string, code = 1): never {
  emit({ ok: false, error: message });
  process.exit(code);
}

function requireUser(args: Args): string {
  const user = args._[1];
  if (!user) fail("usage: foody <command> <user> [...]");
  return user;
}

function cartSummary(state: FoodyState) {
  const lines = state.cart.map((line) => {
    const menuItem = state.menu.find((m) => m.dishId === line.dishId);
    return {
      dishId: line.dishId,
      qty: line.qty,
      emoji: menuItem?.emoji ?? null,
      name: menuItem?.name ?? null,
      unitPrice: menuItem?.price ?? null,
      lineTotal:
        menuItem?.price !== undefined ? +(menuItem.price * line.qty).toFixed(2) : null,
    };
  });
  const subtotal = lines.reduce((s, l) => s + (l.lineTotal ?? 0), 0);
  return { lines, subtotal: +subtotal.toFixed(2) };
}

async function cmdAddress(args: Args) {
  const user = requireUser(args);
  const state = loadState(user);

  if (typeof args.flags.set === "string") {
    state.address = args.flags.set.trim();
    saveState(state);
    return emit({ ok: true, action: "address_set", address: state.address });
  }

  if (args.flags.clear === true) {
    state.address = null;
    saveState(state);
    return emit({ ok: true, action: "address_cleared" });
  }

  return emit({ ok: true, address: state.address });
}

async function cmdRestaurants(args: Args) {
  const user = requireUser(args);
  const state = loadState(user);
  if (!state.address) {
    return emit({ ok: false, error: "no_address", needs: "address" });
  }
  const list = await findRestaurants(state.address, 3);
  return emit({
    ok: true,
    address: state.address,
    restaurants: list.map((r, i) => ({
      index: i + 1,
      id: r.id,
      name: r.name,
      cuisine: r.cuisine,
      rating: r.rating,
      reviewCount: r.reviewCount,
      deliveryTimeMin: r.deliveryTimeMin,
      deliveryFee: r.deliveryFee,
      minOrder: r.minOrder,
    })),
  });
}

async function cmdMenu(args: Args) {
  const user = requireUser(args);
  const state = loadState(user);

  let restaurantId: string | null = null;
  if (typeof args.flags.restaurant === "string") {
    restaurantId = args.flags.restaurant;
  } else if (typeof args.flags.index === "string") {
    // user picked "1", "2", or "3" from the previously shown list
    const idx = Number.parseInt(args.flags.index, 10);
    if (!Number.isFinite(idx) || idx < 1) fail("invalid --index");
    if (!state.address) {
      return emit({ ok: false, error: "no_address", needs: "address" });
    }
    const top = await findRestaurants(state.address, 3);
    const picked = top[idx - 1];
    if (!picked) return emit({ ok: false, error: "index_out_of_range" });
    restaurantId = picked.id;
  } else {
    fail("usage: foody menu <user> --restaurant <id> | --index <1-3>");
  }

  const restaurant = await getRestaurant(restaurantId!);
  if (!restaurant) return emit({ ok: false, error: "restaurant_not_found" });

  const dishes = await getTopDishes(restaurant.id, 10);
  const emojis = assignUniqueEmojis(
    dishes.map((d) => ({
      customSlack: d.customEmoji,
      thematicPrefs: [...emojiPrefsFor(d.category ?? null, d.name), ...(d.slackEmojiPrefs ?? [])],
    })),
  );
  const menu: MenuItem[] = dishes.map((d, i) => ({
    emoji: emojis[i],
    takeawayDishName: d.takeawayDishName,
    dishId: d.id,
    name: d.name,
    price: d.price,
    description: d.description,
    imageUrl: d.imageUrl,
  }));

  // Setting an active restaurant resets the cart — switching restaurants
  // should not silently carry dishes from the previous one.
  state.activeRestaurantId = restaurant.id;
  state.activeRestaurantName = restaurant.name;
  state.menu = menu;
  state.cart = [];
  saveState(state);

  return emit({
    ok: true,
    restaurant: {
      id: restaurant.id,
      name: restaurant.name,
      cuisine: restaurant.cuisine,
      rating: restaurant.rating,
      deliveryTimeMin: restaurant.deliveryTimeMin,
      deliveryFee: restaurant.deliveryFee,
      minOrder: restaurant.minOrder,
    },
    menu,
  });
}

async function cmdCart(args: Args) {
  const user = requireUser(args);
  const state = loadState(user);
  if (!state.activeRestaurantId) {
    return emit({ ok: false, error: "no_active_restaurant", needs: "restaurants" });
  }

  if (args.flags.clear === true) {
    state.cart = [];
    saveState(state);
    return emit({ ok: true, action: "cart_cleared", ...cartSummary(state) });
  }

  const addRaw = typeof args.flags.add === "string" ? args.flags.add : null;
  const removeRaw = typeof args.flags.remove === "string" ? args.flags.remove : null;

  if (addRaw) {
    // Support comma- or space-separated batches like "🍕,🍔" or "🍕 🍔"
    const tokens = addRaw.split(/[\s,]+/).filter(Boolean);
    const unknown: string[] = [];
    for (const t of tokens) {
      const matched = matchMenuEmoji(t, state.menu);
      if (!matched) {
        unknown.push(t);
        continue;
      }
      const menuItem = state.menu.find((m) => m.emoji.unicode === matched.unicode)!;
      const existing = state.cart.find((l) => l.dishId === menuItem.dishId);
      if (existing) existing.qty += 1;
      else state.cart.push({ dishId: menuItem.dishId, qty: 1 });
    }
    saveState(state);
    return emit({
      ok: true,
      action: "cart_add",
      added: tokens.filter((t) => !unknown.includes(t)),
      unknown,
      ...cartSummary(state),
    });
  }

  if (removeRaw) {
    const tokens = removeRaw.split(/[\s,]+/).filter(Boolean);
    for (const t of tokens) {
      const matched = matchMenuEmoji(t, state.menu);
      if (!matched) continue;
      const menuItem = state.menu.find((m) => m.emoji.unicode === matched.unicode)!;
      const existing = state.cart.find((l) => l.dishId === menuItem.dishId);
      if (!existing) continue;
      existing.qty -= 1;
      if (existing.qty <= 0) {
        state.cart = state.cart.filter((l) => l.dishId !== menuItem.dishId);
      }
    }
    saveState(state);
    return emit({ ok: true, action: "cart_remove", ...cartSummary(state) });
  }

  return emit({ ok: true, ...cartSummary(state) });
}

async function cmdOrder(args: Args) {
  const user = requireUser(args);
  const state = loadState(user);

  if (!state.address) return emit({ ok: false, error: "no_address", needs: "address" });
  if (!state.activeRestaurantId) {
    return emit({ ok: false, error: "no_active_restaurant", needs: "restaurants" });
  }
  if (state.cart.length === 0) {
    return emit({ ok: false, error: "empty_cart", needs: "cart" });
  }

  const restaurant = await getRestaurant(state.activeRestaurantId);
  if (!restaurant) return emit({ ok: false, error: "restaurant_not_found" });

  const lines = await Promise.all(
    state.cart.map(async (line) => {
      const dish = await getDish(line.dishId);
      return {
        dishId: line.dishId,
        qty: line.qty,
        name: dish?.name ?? "(unknown)",
        unitPrice: dish?.price ?? 0,
        lineTotal: +(((dish?.price ?? 0) * line.qty)).toFixed(2),
      };
    }),
  );
  const subtotal = +lines.reduce((s, l) => s + l.lineTotal, 0).toFixed(2);

  if (subtotal < restaurant.minOrder) {
    return emit({
      ok: false,
      error: "below_min_order",
      subtotal,
      minOrder: restaurant.minOrder,
      shortBy: +(restaurant.minOrder - subtotal).toFixed(2),
    });
  }

  const total = +(subtotal + restaurant.deliveryFee).toFixed(2);
  const orderId = `FD-${Date.now().toString(36).toUpperCase()}`;
  const etaMin = restaurant.deliveryTimeMin;

  state.lastOrderId = orderId;
  state.cart = [];
  state.activeRestaurantId = null;
  state.activeRestaurantName = null;
  state.menu = [];
  saveState(state);

  // Real fulfilment would POST to takeaway.com here. Emit the receipt so the
  // skill can render a confirmation card on WhatsApp.
  return emit({
    ok: true,
    action: "order_placed",
    orderId,
    restaurant: { id: restaurant.id, name: restaurant.name },
    address: state.address,
    lines,
    subtotal,
    deliveryFee: restaurant.deliveryFee,
    total,
    etaMin,
    fulfilment: "stub",
  });
}

async function cmdStatus(args: Args) {
  const user = requireUser(args);
  const state = loadState(user);
  return emit({
    ok: true,
    state: {
      ...state,
      ...cartSummary(state),
    },
  });
}

async function cmdReset(args: Args) {
  const user = requireUser(args);
  const fresh = resetState(user);
  return emit({ ok: true, action: "reset", state: fresh });
}

function help() {
  emit({
    ok: true,
    usage: [
      "foody address <user> [--set \"...\"] [--clear]",
      "foody restaurants <user>",
      "foody menu <user> --index <1-3> | --restaurant <id>",
      "foody cart <user> [--add EMOJI[,EMOJI...]] [--remove EMOJI] [--clear]",
      "foody order <user>",
      "foody status <user>",
      "foody reset <user>",
    ],
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  switch (cmd) {
    case "address":
      return cmdAddress(args);
    case "restaurants":
      return cmdRestaurants(args);
    case "menu":
      return cmdMenu(args);
    case "cart":
      return cmdCart(args);
    case "order":
      return cmdOrder(args);
    case "status":
      return cmdStatus(args);
    case "reset":
      return cmdReset(args);
    case undefined:
    case "help":
    case "--help":
    case "-h":
      return help();
    default:
      fail(`unknown command: ${cmd}`);
  }
}

main().catch((err) => {
  emit({ ok: false, error: String(err?.message ?? err) });
  process.exit(1);
});
