import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pkg from "@slack/bolt";
import {
  loadState,
  saveState,
  resetState,
  sessionKey,
  getDefaultAddress,
  setDefaultAddress,
  type FoodyState,
  type MenuItem,
} from "../state.ts";
import {
  findRestaurants,
  getRestaurant,
  getTopDishes,
  getDish,
} from "../takeaway.ts";
import { assignUniqueEmojis } from "../emojis.ts";
import {
  isFoodyTrigger,
  isOrderConfirm,
  isResetCommand,
  extractChangeAddress,
} from "./intent.ts";
import {
  restaurantsBlocks,
  menuBlocks,
  cartBlocks,
  receiptBlocks,
} from "./blocks.ts";

const { App } = pkg as unknown as { App: new (...args: any[]) => any };

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = join(__dirname, "..", "..", "state");

const allowedChannels = (process.env.FOODY_CHANNELS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function channelAllowed(channel: string): boolean {
  return allowedChannels.length === 0 || allowedChannels.includes(channel);
}

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  logLevel: (process.env.FOODY_LOG_LEVEL ?? "info") as any,
});

let BOT_USER_ID: string | null = null;

/* ---------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------- */

/** Find a session whose menu message ts matches the reacted message. */
function findSessionByMenuTs(channel: string, menuTs: string): FoodyState | null {
  let files: string[];
  try {
    files = readdirSync(STATE_DIR).filter(
      (f) => f.startsWith(`sess_${channel}_`) && f.endsWith(".json"),
    );
  } catch {
    return null;
  }
  for (const f of files) {
    try {
      const s = JSON.parse(readFileSync(join(STATE_DIR, f), "utf-8")) as FoodyState;
      if (s.menuMessageTs === menuTs) return s;
    } catch {
      // ignore corrupt files
    }
  }
  return null;
}

async function postRestaurants(
  client: any,
  channel: string,
  threadTs: string,
  state: FoodyState,
) {
  if (!state.address) throw new Error("postRestaurants called without an address");
  const restaurants = await findRestaurants(state.address, 3);
  if (restaurants.length === 0) {
    await client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: `Sorry, I can't find any spots near *${state.address}*. Try a different address.`,
    });
    return;
  }
  await client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text: `Top 3 spots near ${state.address}`,
    blocks: restaurantsBlocks(state.address, restaurants, state.user),
  });
}

async function postMenuAndPreReact(
  client: any,
  channel: string,
  threadTs: string,
  state: FoodyState,
) {
  const restaurant = await getRestaurant(state.activeRestaurantId!);
  if (!restaurant) throw new Error("active restaurant not found");

  const dishes = await getTopDishes(restaurant.id, 10);
  const emojis = assignUniqueEmojis(
    dishes.map((d) => ({ customSlack: d.customEmoji, thematicSlack: d.slackEmoji })),
  );
  const menu: MenuItem[] = dishes.map((d, i) => ({
    emoji: emojis[i],
    dishId: d.id,
    name: d.name,
    price: d.price,
    description: d.description,
  }));

  state.menu = menu;
  state.activeRestaurantName = restaurant.name;
  state.cart = [];

  const post = await client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text: `Top picks at ${restaurant.name}`,
    blocks: menuBlocks(restaurant.name, menu, state.user),
  });

  state.menuMessageTs = post.ts as string;
  saveState(state);

  // Pre-react with each dish's emoji so people can one-click instead of opening the picker.
  // Fire sequentially — Slack rate-limits reactions.add to ~1/sec per channel.
  for (const m of menu) {
    try {
      await client.reactions.add({
        channel,
        timestamp: post.ts,
        name: m.emoji.slack,
      });
    } catch (err: any) {
      // already_reacted is harmless; everything else we just log.
      if (err?.data?.error !== "already_reacted") {
        console.warn(`reactions.add ${m.emoji.slack} failed:`, err?.data?.error ?? err);
      }
    }
  }
}

async function postCart(client: any, channel: string, threadTs: string, state: FoodyState) {
  await client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text: "Cart update",
    blocks: cartBlocks(state),
  });
}

/* ---------------------------------------------------------------------------
 * message — trigger detection, address capture, address change, reset, order
 * ------------------------------------------------------------------------- */

app.message(async ({ message, client }: any) => {
  // Bolt sends every message subtype through here. We only want plain user messages.
  if (message.subtype && message.subtype !== "thread_broadcast") return;
  if (message.bot_id || message.user === BOT_USER_ID) return;
  if (!channelAllowed(message.channel)) return;

  const channel: string = message.channel;
  const userId: string = message.user;
  const text: string | undefined = message.text;
  const ts: string = message.ts;
  const threadTs: string = message.thread_ts ?? ts;

  // -- in-thread address answer (we previously asked for one)
  if (message.thread_ts) {
    const sess = loadState(sessionKey(channel, message.thread_ts));
    if (sess.pendingPrompt === "address" && sess.initiator === userId) {
      const addr = text?.trim();
      if (!addr) return;
      sess.address = addr;
      sess.pendingPrompt = null;
      saveState(sess);
      setDefaultAddress(userId, addr);
      await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: `Got it — delivering to *${addr}*. Saved as your default.`,
      });
      await postRestaurants(client, channel, threadTs, sess);
      return;
    }

    // -- in-thread reset
    if (isResetCommand(text)) {
      resetState(sess.user);
      await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: "Cleared this Foody session. Say _let's eat something_ to start again.",
      });
      return;
    }

    // -- in-thread "change address to X"
    const changed = extractChangeAddress(text);
    if (changed && sess.initiator === userId) {
      sess.address = changed;
      saveState(sess);
      setDefaultAddress(userId, changed);
      await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: `Updated delivery to *${changed}*. Saved as your default.`,
      });
      await postRestaurants(client, channel, threadTs, sess);
      return;
    }

    // -- in-thread "order"
    if (isOrderConfirm(text) && sess.activeRestaurantId && sess.cart.length > 0) {
      await placeOrder(client, channel, threadTs, sess);
      return;
    }
  }

  // -- new "let's eat" trigger (must be outside an existing Foody thread)
  if (!isFoodyTrigger(text)) return;

  const key = sessionKey(channel, threadTs);
  const sess = resetState(key); // fresh session
  sess.initiator = userId;

  // Use saved address if we have one. The CLI's `address --set` stores
  // addresses under `addr_<userId>`; the Slack bot mirrors that.
  const savedAddress = getDefaultAddress(userId);
  if (savedAddress) {
    sess.address = savedAddress;
    saveState(sess);
    await client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: `🍴 Foody here. Delivering to *${savedAddress}* (say _change address to ..._ to update).`,
    });
    await postRestaurants(client, channel, threadTs, sess);
    return;
  }

  sess.pendingPrompt = "address";
  saveState(sess);
  await client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text: "🍴 Foody here. Where should we deliver? Reply in this thread with an address (street, postcode, city).",
  });
});

/* ---------------------------------------------------------------------------
 * pick_restaurant button — load menu, post it, pre-react
 * ------------------------------------------------------------------------- */

app.action("pick_restaurant", async ({ ack, body, action, client }: any) => {
  await ack();
  const parsed = JSON.parse(action.value);
  const restaurantId: string = parsed.restaurantId;
  const key: string = parsed.sessionKey;
  const channel: string = body.channel.id;
  const threadTs: string = body.message.thread_ts ?? body.message.ts;

  const sess = loadState(key);
  if (!sess.address) {
    await client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: "I lost the address for this session — say _let's eat something_ again.",
    });
    return;
  }

  sess.activeRestaurantId = restaurantId;
  saveState(sess);
  await postMenuAndPreReact(client, channel, threadTs, sess);
});

/* ---------------------------------------------------------------------------
 * Reactions — the actual "click the emoji" interaction
 * ------------------------------------------------------------------------- */

app.event("reaction_added", async ({ event, client }: any) => {
  if (event.user === BOT_USER_ID) return; // our own pre-reactions
  if (event.item?.type !== "message") return;

  const channel: string = event.item.channel;
  const menuTs: string = event.item.ts;
  if (!channelAllowed(channel)) return;

  const sess = findSessionByMenuTs(channel, menuTs);
  if (!sess) return;

  const menuItem = sess.menu.find((m) => m.emoji.slack === event.reaction);
  if (!menuItem) return;

  const existing = sess.cart.find((l) => l.dishId === menuItem.dishId);
  if (existing) existing.qty += 1;
  else sess.cart.push({ dishId: menuItem.dishId, qty: 1 });
  saveState(sess);

  const threadParent = await resolveThreadTs(client, channel, menuTs);
  await postCart(client, channel, threadParent, sess);
});

app.event("reaction_removed", async ({ event, client }: any) => {
  if (event.user === BOT_USER_ID) return;
  if (event.item?.type !== "message") return;

  const channel: string = event.item.channel;
  const menuTs: string = event.item.ts;
  if (!channelAllowed(channel)) return;

  const sess = findSessionByMenuTs(channel, menuTs);
  if (!sess) return;

  const menuItem = sess.menu.find((m) => m.emoji.slack === event.reaction);
  if (!menuItem) return;

  const existing = sess.cart.find((l) => l.dishId === menuItem.dishId);
  if (!existing) return;
  existing.qty -= 1;
  if (existing.qty <= 0) {
    sess.cart = sess.cart.filter((l) => l.dishId !== menuItem.dishId);
  }
  saveState(sess);

  const threadParent = await resolveThreadTs(client, channel, menuTs);
  await postCart(client, channel, threadParent, sess);
});

async function resolveThreadTs(client: any, channel: string, ts: string): Promise<string> {
  try {
    const info = await client.conversations.history({
      channel,
      latest: ts,
      inclusive: true,
      limit: 1,
    });
    const msg = info.messages?.[0];
    return msg?.thread_ts ?? ts;
  } catch {
    return ts;
  }
}

/* ---------------------------------------------------------------------------
 * place_order button + cancel
 * ------------------------------------------------------------------------- */

async function placeOrder(client: any, channel: string, threadTs: string, sess: FoodyState) {
  if (!sess.address || !sess.activeRestaurantId || sess.cart.length === 0) {
    await client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: "Nothing to order yet — add at least one dish by reacting.",
    });
    return;
  }
  const restaurant = await getRestaurant(sess.activeRestaurantId);
  if (!restaurant) return;

  const lines = await Promise.all(
    sess.cart.map(async (l) => {
      const dish = await getDish(l.dishId);
      const menuItem = sess.menu.find((m) => m.dishId === l.dishId);
      return {
        name: dish?.name ?? "(unknown)",
        qty: l.qty,
        unitPrice: dish?.price ?? 0,
        lineTotal: +(((dish?.price ?? 0) * l.qty)).toFixed(2),
        emoji: menuItem?.emoji.unicode ?? null,
      };
    }),
  );
  const subtotal = +lines.reduce((s, l) => s + l.lineTotal, 0).toFixed(2);
  if (subtotal < restaurant.minOrder) {
    await client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: `Subtotal is ${subtotal.toFixed(2)} but minimum is ${restaurant.minOrder.toFixed(2)} — add ${(restaurant.minOrder - subtotal).toFixed(2)} more.`,
    });
    return;
  }
  const total = +(subtotal + restaurant.deliveryFee).toFixed(2);
  const orderId = `FD-${Date.now().toString(36).toUpperCase()}`;

  sess.lastOrderId = orderId;
  sess.cart = [];
  sess.activeRestaurantId = null;
  sess.activeRestaurantName = null;
  sess.menu = [];
  sess.menuMessageTs = null;
  saveState(sess);

  await client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text: `Order ${orderId} placed`,
    blocks: receiptBlocks({
      orderId,
      restaurantName: restaurant.name,
      address: sess.address,
      lines,
      subtotal,
      deliveryFee: restaurant.deliveryFee,
      total,
      etaMin: restaurant.deliveryTimeMin,
    }),
  });
}

app.action("place_order", async ({ ack, body, action, client }: any) => {
  await ack();
  const key: string = action.value;
  const channel: string = body.channel.id;
  const threadTs: string = body.message.thread_ts ?? body.message.ts;
  const sess = loadState(key);
  await placeOrder(client, channel, threadTs, sess);
});

app.action("cancel_session", async ({ ack, body, action, client }: any) => {
  await ack();
  const key: string = action.value;
  const channel: string = body.channel.id;
  const threadTs: string = body.message.thread_ts ?? body.message.ts;
  resetState(key);
  await client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text: "Cancelled this session. Say _let's eat something_ to start a new one.",
  });
});

/* ---------------------------------------------------------------------------
 * Boot
 * ------------------------------------------------------------------------- */

async function main() {
  await app.start();
  const me = await app.client.auth.test({ token: process.env.SLACK_BOT_TOKEN });
  BOT_USER_ID = me.user_id as string;
  console.log(`Foody is listening as @${me.user} (id ${BOT_USER_ID})`);
  if (allowedChannels.length > 0) {
    console.log(`Restricted to channels: ${allowedChannels.join(", ")}`);
  } else {
    console.log("Listening in all channels the bot is a member of.");
  }
}

main().catch((err) => {
  console.error("Foody failed to start:", err);
  process.exit(1);
});
