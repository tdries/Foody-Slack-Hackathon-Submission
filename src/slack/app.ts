import dotenv from "dotenv";
import { readdirSync, readFileSync } from "node:fs";
// override=true: this project's .env wins over any vars already in the shell,
// so a stray `source ../Slackathon/.env` can't make Foody act as Veritype.
dotenv.config({ override: true });
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
  categoryBlocks,
  menuCartBlocks,
  progressCardBlocks,
  lookupBlocks,
  receiptBlocks,
} from "./blocks.ts";
import { categoryById, CATEGORIES } from "../categories.ts";
import { buildCartOnTakeaway } from "../checkout.ts";
import { schedulePrewarm } from "../prewarm.ts";

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

/**
 * Fake-progress ticker for slow takeaway.com scrapes. The actual scrape time
 * is unknowable up-front (cold start: ~12s, warm cache: instant), so we tick
 * an asymptotic bar toward 90% and let the caller jump it to 100% when done.
 * Returns a stop() to clear the interval.
 */
function startLookupTicker(
  client: any,
  channel: string,
  ts: string,
  title: string,
  subtitle?: string,
): () => void {
  let pct = 5;
  const render = async () => {
    try {
      await client.chat.update({
        channel,
        ts,
        text: title,
        blocks: lookupBlocks({ title, subtitle, pct }),
      });
    } catch {
      // Slack rate limit / message deleted — silently swallow, the final
      // success-update will overwrite anyway.
    }
  };
  void render();
  const interval = setInterval(() => {
    // Asymptotic walk toward 90%.
    pct = Math.min(90, pct + Math.max(3, Math.round((90 - pct) * 0.18)));
    void render();
  }, 1400);
  return () => clearInterval(interval);
}

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

async function postCategoryPicker(
  client: any,
  channel: string,
  threadTs: string,
  state: FoodyState,
) {
  if (!state.address) throw new Error("postCategoryPicker called without an address");
  await client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text: "What are you in the mood for?",
    blocks: categoryBlocks(state.address, state.user),
  });
}

async function postRestaurants(
  client: any,
  channel: string,
  threadTs: string,
  state: FoodyState,
) {
  if (!state.address) throw new Error("postRestaurants called without an address");

  const cat = state.category ? categoryById(state.category) : null;
  const categoryLabel = cat ? `${cat.emoji} ${cat.label}` : null;

  // Live scrape can take 10-15s on first call (puppeteer warmup + address
  // autocomplete + listings load). Post a placeholder so the user isn't
  // staring at silence, then update it with the real results.
  const lookupTitle = categoryLabel
    ? `Looking up ${cat?.label.toLowerCase()} spots near you`
    : "Looking up real restaurants near you";
  const placeholder = await client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text: lookupTitle,
    blocks: lookupBlocks({ title: lookupTitle, subtitle: `📍 *${state.address}*`, pct: 5 }),
  });
  const stopTicker = startLookupTicker(client, channel, placeholder.ts as string, lookupTitle, `📍 *${state.address}*`);

  const restaurants = await findRestaurants(state.address, 3, state.category);
  stopTicker();
  if (restaurants.length === 0) {
    await client.chat.update({
      channel,
      ts: placeholder.ts,
      text: `Sorry, I can't find any spots near *${state.address}*. Try a different address.`,
    });
    return;
  }
  await client.chat.update({
    channel,
    ts: placeholder.ts,
    text: categoryLabel
      ? `Top 3 ${cat?.label.toLowerCase()} spots near ${state.address}`
      : `Top 3 spots near ${state.address}`,
    blocks: restaurantsBlocks(state.address, restaurants, state.user, cat?.label),
  });
}

async function postMenuAndPreReact(
  client: any,
  channel: string,
  threadTs: string,
  state: FoodyState,
) {
  // Prefer the snapshot stored on the session — survives a bot restart. Fall
  // back to the (possibly empty) live cache only if the snapshot is missing
  // (older session files written before activeRestaurant existed).
  const restaurant = state.activeRestaurant ?? (await getRestaurant(state.activeRestaurantId!));
  if (!restaurant) throw new Error("active restaurant not found");

  // Placeholder for the (potentially slow) menu scrape — same pattern as
  // postRestaurants. Reacting on a placeholder is fine: chat.update replaces
  // the blocks but the ts stays stable, so pre-reactions land on the new menu.
  const menuLookupTitle = `Loading menu — ${restaurant.name}`;
  const post = await client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text: menuLookupTitle,
    blocks: lookupBlocks({ title: menuLookupTitle, subtitle: "_Picking the top dishes…_", pct: 5 }),
  });
  const stopMenuTicker = startLookupTicker(
    client,
    channel,
    post.ts as string,
    menuLookupTitle,
    "_Picking the top dishes…_",
  );

  const dishes = await getTopDishes(restaurant.id, 10);
  stopMenuTicker();
  if (dishes.length === 0) {
    await client.chat.update({
      channel,
      ts: post.ts,
      text: `Couldn't load the menu for ${restaurant.name}.`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:warning: Couldn't load the menu for *${restaurant.name}*. The takeaway.com page may have a different layout — try a different restaurant or check the bot logs.`,
          },
        },
      ],
    });
    return;
  }
  const emojis = assignUniqueEmojis(
    dishes.map((d) => ({ customSlack: d.customEmoji, thematicPrefs: d.slackEmojiPrefs })),
  );
  const menu: MenuItem[] = dishes.map((d, i) => ({
    emoji: emojis[i],
    takeawayDishName: d.takeawayDishName,
    takeawayDishId: d.takeawayDishId,
    dishId: d.id,
    name: d.name,
    price: d.price,
    description: d.description,
  }));

  state.menu = menu;
  state.activeRestaurantName = restaurant.name;
  state.cart = [];
  state.menuMessageTs = post.ts as string;

  await client.chat.update({
    channel,
    ts: post.ts,
    text: `Top picks at ${restaurant.name}`,
    blocks: menuCartBlocks(state, state.user),
  });

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

async function postCart(client: any, channel: string, state: FoodyState) {
  // Cart no longer lives in its own message — the unified menu+cart card we
  // posted as `menuMessageTs` shows every dish with a live qty prefix and the
  // running total. Reactions land on that message; we just re-render it.
  if (!state.menuMessageTs) return;
  try {
    await client.chat.update({
      channel,
      ts: state.menuMessageTs,
      text: `Cart update at ${state.activeRestaurantName ?? "your restaurant"}`,
      blocks: menuCartBlocks(state, state.user),
    });
  } catch (err: any) {
    console.warn(`menu+cart update failed (${err?.data?.error ?? err})`);
  }
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
      await postCategoryPicker(client, channel, threadTs, sess);
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
      // Address changed → previous category pick may no longer be relevant
      // (different neighbourhood, different cuisine mix). Reset and re-pick.
      sess.category = null;
      saveState(sess);
      setDefaultAddress(userId, changed);
      await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: `Updated delivery to *${changed}*. Saved as your default.`,
      });
      await postCategoryPicker(client, channel, threadTs, sess);
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
    await postCategoryPicker(client, channel, threadTs, sess);
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
 * pick_category_<id> button — set category, fetch top 3 matching restaurants
 * ------------------------------------------------------------------------- */

for (const cat of CATEGORIES) {
  app.action(`pick_category_${cat.id}`, async ({ ack, body, action, client }: any) => {
    await ack();
    const parsed = JSON.parse(action.value);
    const categoryId: string = parsed.categoryId;
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
    sess.category = categoryId;
    saveState(sess);
    await postRestaurants(client, channel, threadTs, sess);
  });
}

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

  // Snapshot the full restaurant into the session so a bot restart between
  // pick and order doesn't lose it (the live in-memory cache is wiped on restart).
  const picked = await getRestaurant(restaurantId);
  if (!picked) {
    await client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: `Couldn't find that restaurant anymore — say _let's eat something_ to refresh.`,
    });
    return;
  }
  sess.activeRestaurantId = restaurantId;
  sess.activeRestaurant = picked;
  saveState(sess);

  // Collapse the restaurant-list message to just the chosen pick — the other
  // two cards are no longer relevant and add visual noise above the menu.
  const listTs: string | undefined = body.message?.ts;
  if (listTs) {
    try {
      await client.chat.update({
        channel,
        ts: listTs,
        text: `Picked ${picked.name}`,
        blocks: [
          {
            type: "context",
            elements: [{ type: "mrkdwn", text: `:white_check_mark:  Picked  *${picked.name}*` }],
          },
        ],
      });
    } catch (err: any) {
      console.warn(`pick_restaurant: failed to collapse list (${err?.data?.error ?? err})`);
    }
  }

  await postMenuAndPreReact(client, channel, threadTs, sess);
});

/* ---------------------------------------------------------------------------
 * Reactions — the actual "click the emoji" interaction
 * ------------------------------------------------------------------------- */

app.event("reaction_added", async ({ event, client }: any) => {
  console.log(`[reaction_added] user=${event.user} reaction=${event.reaction} item.ts=${event.item?.ts} item.channel=${event.item?.channel} bot=${BOT_USER_ID}`);
  if (event.user === BOT_USER_ID) return; // our own pre-reactions
  if (event.item?.type !== "message") return;

  const channel: string = event.item.channel;
  const menuTs: string = event.item.ts;
  if (!channelAllowed(channel)) {
    console.log(`[reaction_added] channel ${channel} not allowed — skipping`);
    return;
  }

  const sess = findSessionByMenuTs(channel, menuTs);
  if (!sess) {
    console.log(`[reaction_added] no session matches menuTs=${menuTs} in channel=${channel} — reaction ignored`);
    return;
  }

  const menuItem = sess.menu.find((m) => m.emoji.slack === event.reaction);
  if (!menuItem) {
    console.log(`[reaction_added] reaction :${event.reaction}: not in menu (menu emojis: ${sess.menu.map((m) => m.emoji.slack).join(", ")})`);
    return;
  }
  console.log(`[reaction_added] adding "${menuItem.name}" to cart in ${sess.user}`);

  const existing = sess.cart.find((l) => l.dishId === menuItem.dishId);
  if (existing) existing.qty += 1;
  else sess.cart.push({ dishId: menuItem.dishId, qty: 1 });
  saveState(sess);

  await postCart(client, channel, sess);
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

  await postCart(client, channel, sess);
});

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
  const restaurant = sess.activeRestaurant ?? (await getRestaurant(sess.activeRestaurantId));
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

  // Real restaurant? Drive a real cart-build in the user's Chrome.
  // We hold off on clearing the session until after the build attempt
  // succeeds, so a failed Chrome connection doesn't lose the cart.
  if (restaurant.takeawayUrl) {
    // Single live message that morphs through connecting → opening → adding → done.
    const totalLines = sess.cart.length;
    const initialBlocks = progressCardBlocks({
      restaurantName: restaurant.name,
      stage: "connecting",
      total: totalLines,
    });
    const posted = await client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: `Building your cart on ${restaurant.name}…`,
      blocks: initialBlocks,
    });
    const progressTs: string = posted.ts;

    const updateProgress = async (blocks: any[], text: string) => {
      try {
        await client.chat.update({ channel, ts: progressTs, text, blocks });
      } catch (err: any) {
        console.warn(`progress update failed: ${err?.data?.error ?? err}`);
      }
    };

    const result = await buildCartOnTakeaway(sess, restaurant, {
      onProgress: async (event) => {
        if (event.stage === "connecting") {
          await updateProgress(
            progressCardBlocks({ restaurantName: restaurant.name, stage: "connecting", total: totalLines }),
            "Connecting to your Chrome…",
          );
        } else if (event.stage === "navigating") {
          await updateProgress(
            progressCardBlocks({ restaurantName: restaurant.name, stage: "navigating", total: totalLines }),
            `Opening ${restaurant.name}…`,
          );
        } else if (event.stage === "adding") {
          await updateProgress(
            progressCardBlocks({
              restaurantName: restaurant.name,
              stage: "adding",
              current: event.current,
              total: event.total,
              detail: event.itemName,
            }),
            `Adding ${event.itemName} (${event.current}/${event.total})…`,
          );
        }
        // 'done' and 'failed' are rendered below with the final payload (has url + failedItems).
      },
    });

    if (result.ok) {
      sess.lastOrderId = orderId;
      sess.cart = [];
      sess.activeRestaurantId = null;
      sess.activeRestaurantName = null;
      sess.activeRestaurant = null;
      sess.menu = [];
      sess.menuMessageTs = null;
      saveState(sess);
    }

    if (result.needsLink) {
      await updateProgress(
        [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*🔌  Foody-Chrome not running*\n${result.message}`,
            },
          },
        ],
        "Chrome not reachable",
      );
      return;
    }

    await updateProgress(
      progressCardBlocks({
        restaurantName: restaurant.name,
        stage: result.ok ? "done" : "failed",
        current: result.added.length,
        total: totalLines,
        payUrl: result.url,
        failedItems: result.failed,
        detail: result.ok ? undefined : `Built ${result.added.length} of ${totalLines} item${totalLines === 1 ? "" : "s"}.`,
      }),
      result.ok ? "Cart ready — tap to pay" : "Cart build issue",
    );
    return;
  }

  // Mock restaurant — keep the stub receipt path.
  sess.lastOrderId = orderId;
  sess.cart = [];
  sess.activeRestaurantId = null;
  sess.activeRestaurantName = null;
  sess.activeRestaurant = null;
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

/**
 * Walks every reply in a thread and deletes the ones posted by us. Keeps the
 * thread root (the user's "let's eat" message) and any non-bot messages
 * (user chatter) intact. Used by Cancel to fully clear the thread back to a
 * blank slate before posting a fresh category picker.
 */
async function deleteBotMessagesInThread(
  client: any,
  channel: string,
  threadTs: string,
): Promise<number> {
  let cursor: string | undefined;
  let deleted = 0;
  do {
    const result = await client.conversations.replies({
      channel,
      ts: threadTs,
      cursor,
      limit: 200,
    });
    const msgs: Array<{ ts: string; user?: string; bot_id?: string }> = result.messages ?? [];
    for (const msg of msgs) {
      if (msg.ts === threadTs) continue; // never delete the thread root
      const isUs = msg.user === BOT_USER_ID || !!msg.bot_id;
      if (!isUs) continue;
      try {
        await client.chat.delete({ channel, ts: msg.ts });
        deleted += 1;
      } catch (err: any) {
        // message_not_found = already gone; cant_delete_message = too old / unowned.
        const code = err?.data?.error;
        if (code !== "message_not_found" && code !== "cant_delete_message") {
          console.warn(`cancel: chat.delete failed: ${code ?? err}`);
        }
      }
    }
    cursor = result.response_metadata?.next_cursor;
  } while (cursor);
  return deleted;
}

app.action("cancel_session", async ({ ack, body, action, client }: any) => {
  await ack();
  const key: string = action.value;
  const channel: string = body.channel.id;
  const threadTs: string = body.message.thread_ts ?? body.message.ts;

  const sess = loadState(key);
  const address = sess.address;

  // Sweep every bot message in this thread — the menu+cart card, the
  // restaurants list (or its collapsed "Picked X" remnant), every progress
  // placeholder, the lot. Reactions are tied to the messages and disappear
  // with them, so no separate reactions.remove pass is needed.
  const removed = await deleteBotMessagesInThread(client, channel, threadTs);
  console.log(`cancel: wiped ${removed} bot message(s) in thread ${threadTs}`);

  // Soft-reset session: keep address only.
  sess.category = null;
  sess.activeRestaurantId = null;
  sess.activeRestaurantName = null;
  sess.activeRestaurant = null;
  sess.menu = [];
  sess.cart = [];
  sess.menuMessageTs = null;
  sess.pendingPrompt = null;
  saveState(sess);

  if (!address) {
    await client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: "Cancelled — what's your delivery address?",
    });
    return;
  }

  await client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text: "What are you in the mood for?",
    blocks: categoryBlocks(address, key),
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
  // Daily background refresh of restaurant/menu cache for known addresses.
  if (process.env.FOODY_PREWARM !== "0") schedulePrewarm();
}

main().catch((err) => {
  console.error("Foody failed to start:", err);
  process.exit(1);
});
