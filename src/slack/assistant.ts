/**
 * Foody's AI assistant surface — Slack's "AI apps" split pane.
 *
 * The channel flow (app.ts) stays deterministic; this file adds the
 * conversational brain: a Claude tool-use loop that maps free text
 * ("sushi for 6 under €20 near the office") onto Foody's existing
 * machinery — restaurant search, menus, sticky addresses — and hands
 * off to the channel reaction-cart flow via start_group_order.
 */
import pkg from "@slack/bolt";
import Anthropic from "@anthropic-ai/sdk";
import { findRestaurants, getRestaurant, getTopDishes } from "../takeaway.ts";
import {
  sessionKey,
  resetState,
  saveState,
  getDefaultAddress,
  setDefaultAddress,
  type FoodyState,
} from "../state.ts";
import { CATEGORIES } from "../categories.ts";

const { Assistant } = pkg as unknown as { Assistant: new (...args: any[]) => any };

const MODEL = "claude-opus-4-8";
const MAX_TOOL_ROUNDS = 6;

const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

const TOOLS: Anthropic.Tool[] = [
  {
    name: "find_restaurants",
    description:
      "Search takeaway.com for the top delivery restaurants near an address. Call this whenever the user wants food suggestions, names a cuisine, or asks what's available nearby. Returns up to 3 restaurants with id, rating, delivery time, delivery fee and minimum order (EUR).",
    input_schema: {
      type: "object",
      properties: {
        address: { type: "string", description: "Delivery address (street, postcode, city)" },
        category: { type: "string", enum: CATEGORY_IDS, description: "Optional cuisine filter" },
      },
      required: ["address"],
    },
  },
  {
    name: "get_menu",
    description:
      "Fetch the top 10 dishes (name, price in EUR, description) of a restaurant returned by find_restaurants. Call this when the user asks what a place serves, about prices, or whether something fits a diet or budget.",
    input_schema: {
      type: "object",
      properties: {
        restaurant_id: { type: "string", description: "id from a find_restaurants result" },
      },
      required: ["restaurant_id"],
    },
  },
  {
    name: "save_default_address",
    description:
      "Persist the user's default delivery address. Call this when the user tells you their address for the first time or asks to change it.",
    input_schema: {
      type: "object",
      properties: { address: { type: "string" } },
      required: ["address"],
    },
  },
  {
    name: "start_group_order",
    description:
      "Kick off a Foody group order in a Slack channel: posts the top restaurant cards (or, when restaurant_id is given, that restaurant's menu with one-tap emoji reactions) so the whole team fills a shared cart together. Call this once the user has confirmed an address and what they're in the mood for — it is the goal of most conversations.",
    input_schema: {
      type: "object",
      properties: {
        address: { type: "string" },
        category: { type: "string", enum: CATEGORY_IDS },
        restaurant_id: {
          type: "string",
          description: "Skip the restaurant picker and go straight to this restaurant's menu",
        },
        channel_id: {
          type: "string",
          description: "Target Slack channel: an ID like \"C0123456789\" or the exact channel name like \"foody-demo\" — never ask the user for an ID; omit to use the channel the user came from",
        },
        menu_view: {
          type: "string",
          enum: ["photos", "grid"],
          description: "How the menu renders: \"photos\" shows each dish with its real takeaway.com photo, \"grid\" is the compact 2-column emoji list (default). Use \"photos\" when the user asks for pictures/photos of the food.",
        },
      },
      required: ["address"],
    },
  },
];

export type GroupOrderRequest = {
  address: string;
  category?: string;
  restaurant_id?: string;
  channel_id?: string;
  menu_view?: "photos" | "grid";
};

/**
 * One assistant turn: Claude + tools, looping until it stops calling tools.
 * Pure of Slack except for the injected startGroupOrder, so it can be
 * exercised offline (see scripts/smoke-assistant.mts).
 */
export async function runAssistantTurn(opts: {
  history: Anthropic.MessageParam[];
  userId: string;
  contextChannel: string | null;
  onStatus?: (status: string) => Promise<void>;
  startGroupOrder: (req: GroupOrderRequest) => Promise<string>;
}): Promise<string> {
  const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY
  const saved = getDefaultAddress(opts.userId);
  const system = [
    "You are Foody, a Slack assistant for group food ordering via takeaway.com.",
    "The goal of most conversations is start_group_order: Foody posts a menu in a channel, teammates react with dish emojis to fill a shared cart, then anyone hits Order.",
    "Menus render as a compact emoji grid by default, or as a photo menu with real dish photos (menu_view: \"photos\"). The order starter can also flip between views anytime with the 🍽️/📋 button on the menu card.",
    `You are talking to Slack user <@${opts.userId}>.`,
    saved
      ? `Their saved delivery address: ${saved}. Reuse it unless they give another.`
      : "No saved delivery address yet — ask for one (street, postcode, city) before searching or ordering.",
    opts.contextChannel
      ? `They opened this chat from channel <#${opts.contextChannel}>; use it for group orders unless told otherwise.`
      : "You don't know which channel they came from — ask which channel the group order should go to (just the name, like #foody-demo) before calling start_group_order. Never ask for a channel ID.",
    "Style: Slack mrkdwn only (*bold*, _italic_, • bullets). No markdown headings, no tables, no **double asterisks**. Prices in €. Keep replies short — this is chat.",
    "Never invent restaurants or dishes; only cite tool results.",
  ].join("\n");

  const messages: Anthropic.MessageParam[] = [...opts.history];
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" }, // chat: latency over exhaustive deliberation
      tools: TOOLS,
      messages,
    });

    if (response.stop_reason !== "tool_use") {
      const text = response.content
        .filter((b) => b.type === "text")
        .map((b) => (b as Anthropic.TextBlock).text)
        .join("\n")
        .trim();
      return text || "Hmm, I came up empty — try rephrasing?";
    }

    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      const { content, is_error } = await execTool(block, opts);
      results.push({ type: "tool_result", tool_use_id: block.id, content, is_error });
    }
    messages.push({ role: "user", content: results });
  }
  return "That took more steps than I expected — mind rephrasing?";
}

async function execTool(
  block: Anthropic.ToolUseBlock,
  opts: Parameters<typeof runAssistantTurn>[0],
): Promise<{ content: string; is_error?: boolean }> {
  const input = block.input as any;
  try {
    switch (block.name) {
      case "find_restaurants": {
        await opts.onStatus?.(`is scanning takeaway.com near ${input.address}…`);
        const found = await findRestaurants(input.address, 3, input.category ?? null);
        if (found.length === 0)
          return { content: "no restaurants found near that address", is_error: true };
        return {
          content: JSON.stringify(
            found.map((r) => ({
              id: r.id,
              name: r.name,
              cuisine: r.cuisine,
              rating: r.rating,
              delivery_min: r.deliveryTimeMin,
              delivery_fee: r.deliveryFee,
              min_order: r.minOrder,
            })),
          ),
        };
      }
      case "get_menu": {
        await opts.onStatus?.("is reading the menu…");
        const dishes = await getTopDishes(input.restaurant_id, 10);
        if (dishes.length === 0)
          return { content: "menu unavailable for this restaurant", is_error: true };
        return {
          content: JSON.stringify(
            dishes.map((d) => ({ name: d.name, price: d.price, description: d.description })),
          ),
        };
      }
      case "save_default_address":
        setDefaultAddress(opts.userId, input.address);
        return { content: `saved: ${input.address}` };
      case "start_group_order":
        await opts.onStatus?.("is setting up the group order…");
        return { content: await opts.startGroupOrder(input as GroupOrderRequest) };
      default:
        return { content: `unknown tool ${block.name}`, is_error: true };
    }
  } catch (err: any) {
    return { content: `tool failed: ${err?.message ?? err}`, is_error: true };
  }
}

/* ---------------------------------------------------------------------------
 * Slack wiring
 * ------------------------------------------------------------------------- */

export type GroupOrderHelpers = {
  channelAllowed: (channel: string) => boolean;
  postRestaurants: (client: any, channel: string, threadTs: string, state: FoodyState) => Promise<void>;
  postMenuAndPreReact: (client: any, channel: string, threadTs: string, state: FoodyState) => Promise<void>;
};

/** Bridge from the assistant pane into the classic channel flow. */
async function startGroupOrder(
  client: any,
  helpers: GroupOrderHelpers,
  userId: string,
  contextChannel: string | null,
  req: GroupOrderRequest,
): Promise<string> {
  let channel = req.channel_id ?? contextChannel;
  if (!channel)
    return JSON.stringify({
      ok: false,
      error: "no_channel",
      hint: "Ask the user which channel to post the group order in.",
    });
  if (!helpers.channelAllowed(channel))
    return JSON.stringify({
      ok: false,
      error: "channel_not_allowed",
      hint: "Foody is restricted to specific channels (FOODY_CHANNELS) and this isn't one of them.",
    });

  let rootTs: string;
  try {
    const root = await client.chat.postMessage({
      channel,
      text: `🍴 <@${userId}> started a group order — delivering to *${req.address}*`,
    });
    rootTs = root.ts as string;
    // Claude sometimes fills channel_id with a channel *name* ("foody-demo").
    // postMessage tolerates names, but chat.update and the session key need
    // the real ID — adopt the ID Slack resolved it to.
    channel = (root.channel as string) ?? channel;
  } catch (err: any) {
    const code = err?.data?.error;
    if (code === "not_in_channel" || code === "channel_not_found")
      return JSON.stringify({
        ok: false,
        error: code,
        hint: "Tell the user to run `/invite @Foody` in that channel first, then try again.",
      });
    throw err;
  }

  // Same session shape the channel flow builds — its action handlers and
  // reaction events take over from here without knowing the AI was involved.
  const sess = resetState(sessionKey(channel, rootTs));
  sess.initiator = userId;
  sess.address = req.address;
  sess.category = req.category ?? null;
  if (req.menu_view) sess.menuView = req.menu_view;
  setDefaultAddress(userId, req.address);

  if (req.restaurant_id) {
    const picked = await getRestaurant(req.restaurant_id);
    if (picked) {
      sess.activeRestaurantId = picked.id;
      sess.activeRestaurant = picked;
    }
  }
  saveState(sess);

  if (sess.activeRestaurantId) await helpers.postMenuAndPreReact(client, channel, rootTs, sess);
  else await helpers.postRestaurants(client, channel, rootTs, sess);

  const permalink = await client.chat
    .getPermalink({ channel, message_ts: rootTs })
    .catch(() => null);
  return JSON.stringify({
    ok: true,
    posted: sess.activeRestaurantId ? "menu with one-tap emoji reactions" : "top-3 restaurant cards",
    channel: `<#${channel}>`,
    link: permalink?.permalink ?? null,
    next: "Teammates react with the dish emojis to fill the shared cart; anyone can hit Order.",
  });
}

/** Rebuild the Claude conversation from the Slack assistant thread. */
async function fetchThreadHistory(
  client: any,
  channel: string,
  threadTs: string,
): Promise<Anthropic.MessageParam[]> {
  const result = await client.conversations.replies({ channel, ts: threadTs, limit: 40 });
  const history: Anthropic.MessageParam[] = [];
  for (const m of result.messages ?? []) {
    if (!m.text || m.subtype) continue; // skip thread-root marker & system subtypes
    history.push({ role: m.bot_id ? "assistant" : "user", content: m.text });
  }
  while (history.length && history[0].role === "assistant") history.shift(); // API: first must be user
  return history.slice(-20);
}

export function registerAssistant(app: any, helpers: GroupOrderHelpers): void {
  const assistant = new Assistant({
    threadStarted: async ({ say, setSuggestedPrompts }: any) => {
      await say(
        "👋 I'm Foody. Tell me what the team is hungry for — I'll find the spots, check the menus, and kick off a group order in your channel.",
      );
      await setSuggestedPrompts({
        title: "Try one of these:",
        prompts: [
          {
            title: "🍕 Feed the team",
            message: "Find the best pizza near the office and start a group order.",
          },
          {
            title: "🍣 Sushi on a budget",
            message: "What are the top sushi spots near us, and is there something under €15?",
          },
          { title: "📍 Set my address", message: "Change my delivery address to " },
        ],
      });
    },

    userMessage: async ({ client, message, say, setTitle, setStatus, getThreadContext }: any) => {
      try {
        if (!message.thread_ts) return;
        await setStatus("is thinking…");
        await setTitle((message.text ?? "New chat").slice(0, 50)).catch(() => {});
        const context = await getThreadContext().catch(() => null);
        const contextChannel: string | null = context?.channel_id ?? null;
        const history = await fetchThreadHistory(client, message.channel, message.thread_ts);

        const reply = await runAssistantTurn({
          history,
          userId: message.user,
          contextChannel,
          onStatus: async (s) => {
            try {
              await setStatus(s);
            } catch {
              /* status is cosmetic */
            }
          },
          startGroupOrder: (req) =>
            startGroupOrder(client, helpers, message.user, contextChannel, req),
        });
        await say(reply);
      } catch (err: any) {
        console.error("[assistant] turn failed:", err);
        await say(
          `:warning: Something went wrong on my side (${err?.message ?? "unknown error"}). Try again?`,
        );
      }
    },
  });
  app.assistant(assistant);
}
