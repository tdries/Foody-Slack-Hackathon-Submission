import type { Restaurant } from "../takeaway.ts";
import type { FoodyState, MenuItem } from "../state.ts";
import { CATEGORIES } from "../categories.ts";

type Block = Record<string, unknown>;

function eur(n: number): string {
  return `€${n.toFixed(2)}`;
}

function stars(rating: number): string {
  const rounded = Math.round(rating * 10) / 10;
  return `⭐ ${rounded.toFixed(1)}`;
}

export function categoryBlocks(address: string, sessionKey: string): Block[] {
  // Slack action blocks render 5 buttons per row, so 8 categories wrap into 2
  // rows of 4 — looks clean.
  return [
    {
      type: "header",
      text: { type: "plain_text", text: "What are you in the mood for?", emoji: true },
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `📍  *${address}*` }],
    },
    { type: "divider" },
    {
      type: "actions",
      elements: CATEGORIES.map((c) => ({
        type: "button",
        text: { type: "plain_text", text: `${c.emoji} ${c.label}`, emoji: true },
        action_id: `pick_category_${c.id}`,
        value: JSON.stringify({ categoryId: c.id, sessionKey }),
      })),
    },
  ];
}

export function restaurantsBlocks(
  address: string,
  restaurants: Restaurant[],
  sessionKey: string,
  categoryLabel?: string,
): Block[] {
  const header = categoryLabel
    ? `Top 3 ${categoryLabel.toLowerCase()} spots near you`
    : "Top 3 spots near you";
  const blocks: Block[] = [
    {
      type: "header",
      text: { type: "plain_text", text: header, emoji: true },
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `📍  *${address}*` }],
    },
    { type: "divider" },
  ];

  // No takeawayUrl on any result = the static demo dataset, i.e. the live
  // scrape failed (or live mode is off) and we silently fell back. Say so —
  // convincing-but-fake results mislead more than an honest label.
  if (restaurants.length > 0 && restaurants.every((r) => !r.takeawayUrl)) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: "⚠️ _Showing demo data — takeaway.com was unreachable._" }],
    });
  }

  restaurants.forEach((r, idx) => {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${r.name}*  ·  _${r.cuisine}_\n${stars(r.rating)}  (${r.reviewCount})   ·   ⏱ ${r.deliveryTimeMin} min   ·   🛵 ${eur(r.deliveryFee)}   ·   min ${eur(r.minOrder)}`,
      },
      accessory: {
        type: "button",
        text: { type: "plain_text", text: "See menu →", emoji: true },
        action_id: "pick_restaurant",
        value: JSON.stringify({ restaurantId: r.id, sessionKey }),
      },
    });
    if (idx < restaurants.length - 1) blocks.push({ type: "divider" });
  });

  return blocks;
}

/**
 * Unified menu + cart card. The whole order flow lives in a single live
 * message: every dish shows a qty prefix (0×, 1×, …) that updates in place as
 * reactions land, totals + Order button sit at the bottom. No separate cart
 * message anywhere — single source of truth, single scroll position.
 */
export function menuCartBlocks(state: FoodyState, sessionKey: string): Block[] {
  const restaurantName = state.activeRestaurantName ?? "your restaurant";
  const menu = state.menu;
  const qtyByDish = new Map(state.cart.map((l) => [l.dishId, l.qty]));

  const blocks: Block[] = [
    {
      type: "header",
      text: { type: "plain_text", text: restaurantName, emoji: true },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "_Tap the emoji reaction under a dish to add it. React again to add more · remove your reaction to take one out._",
        },
      ],
    },
    { type: "divider" },
  ];

  if (state.activeRestaurant && !state.activeRestaurant.takeawayUrl) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: "⚠️ _Showing demo data — takeaway.com was unreachable._" }],
    });
  }

  // Render up to 10 dishes in a 2-column ranked grid. Slack section.fields
  // reads left-to-right, top-to-bottom, so we interleave the halves to get:
  //   col 1 (ranks 1-5)  |  col 2 (ranks 6-10)
  const formatDishField = (m: MenuItem) => {
    const qty = qtyByDish.get(m.dishId) ?? 0;
    const text = qty > 0
      ? `*${qty}×*  ${m.emoji.unicode}  *${m.name}*  *${eur(m.price * qty)}*`
      : `\`0×\`  ${m.emoji.unicode}  ${m.name}  ${eur(m.price)}`;
    return { type: "mrkdwn", text };
  };

  const hasPhotos = menu.some((m) => m.imageUrl);
  if (state.menuView === "photos" && !hasPhotos && menu.length > 0) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "📷 _No food images available for this restaurant — showing the compact menu._",
        },
      ],
    });
  }
  if (state.menuView === "photos" && hasPhotos && menu.length > 0) {
    // Photo view: one section per dish with the dish photo as a right-hand
    // thumbnail accessory. Same message, same reactions — display only.
    for (const m of menu) {
      const qty = qtyByDish.get(m.dishId) ?? 0;
      const line = qty > 0
        ? `*${qty}×*  ${m.emoji.unicode}  *${m.name}*  ·  *${eur(m.price * qty)}*`
        : `${m.emoji.unicode}  *${m.name}*  ·  ${eur(m.price)}`;
      const block: any = {
        type: "section",
        text: { type: "mrkdwn", text: m.description ? `${line}\n_${m.description}_` : line },
      };
      if (m.imageUrl) {
        block.accessory = { type: "image", image_url: m.imageUrl, alt_text: m.name };
      }
      blocks.push(block);
    }
  } else if (menu.length > 0) {
    const half = Math.ceil(menu.length / 2);
    const left = menu.slice(0, half);
    const right = menu.slice(half);
    const interleaved: Array<{ type: string; text: string }> = [];
    for (let i = 0; i < half; i++) {
      interleaved.push(formatDishField(left[i]));
      if (right[i]) interleaved.push(formatDishField(right[i]));
    }
    blocks.push({ type: "section", fields: interleaved.slice(0, 10) });
  }

  blocks.push({ type: "divider" });

  const subtotal = state.cart.reduce((s, l) => {
    const item = menu.find((m) => m.dishId === l.dishId);
    return s + (item ? item.price * l.qty : 0);
  }, 0);
  const deliveryFee = state.activeRestaurant?.deliveryFee ?? 0;
  const minOrder = state.activeRestaurant?.minOrder ?? 0;
  const total = subtotal + deliveryFee;
  const underMin = minOrder > 0 && subtotal < minOrder;
  const itemCount = state.cart.reduce((n, l) => n + l.qty, 0);

  const minLabel = minOrder > 0
    ? `Min *${eur(minOrder)}* ${underMin ? "✗" : "✓"}`
    : `Min  —`;
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text:
        `Subtotal *${eur(subtotal)}*   ·   Delivery *${eur(deliveryFee)}*   ·   ` +
        `*TOTAL ${eur(total)}*   ·   ${minLabel}`,
    },
  });

  if (underMin && subtotal > 0) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `:warning:  Add *${eur(minOrder - subtotal)}* more to reach the minimum order.`,
        },
      ],
    });
  }

  blocks.push({ type: "divider" });

  const actionElements: any[] = [];
  if (itemCount > 0) {
    actionElements.push({
      type: "button",
      style: "primary",
      text: { type: "plain_text", text: "🛒  Order now", emoji: true },
      action_id: "place_order",
      value: sessionKey,
    });
  }
  // Only offer photo view when at least one dish actually has a photo
  // (mock/stale-cached menus don't) — a toggle to an identical view is noise.
  if (menu.some((m) => m.imageUrl)) {
    actionElements.push({
      type: "button",
      text: {
        type: "plain_text",
        text: state.menuView === "photos" ? "📋  Compact view" : "🍽️  Photo view",
        emoji: true,
      },
      action_id: "toggle_menu_view",
      value: sessionKey,
    });
  }
  actionElements.push({
    type: "button",
    text: { type: "plain_text", text: "Cancel", emoji: true },
    action_id: "cancel_session",
    value: sessionKey,
    style: "danger",
  });
  blocks.push({ type: "actions", elements: actionElements });

  return blocks;
}

/* Receipt typography — used by cart + progress cards. The Slack code block
 * renders sans-serif on mobile but monospace on desktop; either way, padding
 * to a fixed column width keeps the prices flush on the right. */
const TICKET_WIDTH = 38;

function ticketRow(left: string, right: string): string {
  const maxLeft = TICKET_WIDTH - right.length - 1;
  const trimmed = left.length > maxLeft ? left.slice(0, maxLeft - 1) + "…" : left;
  const space = Math.max(1, TICKET_WIDTH - trimmed.length - right.length);
  return `${trimmed}${" ".repeat(space)}${right}`;
}

function ticketRule(): string {
  return "─".repeat(TICKET_WIDTH);
}

export function cartBlocks(state: FoodyState, sessionKey: string): Block[] {
  const restaurantName = state.activeRestaurantName ?? "your restaurant";

  if (state.cart.length === 0) {
    return [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `🛒  *Your cart at ${restaurantName}*\n_Empty for now — react with the emoji under any dish above to add it._`,
        },
      },
      { type: "divider" },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Cancel", emoji: true },
            action_id: "cancel_session",
            value: sessionKey,
            style: "danger",
          },
        ],
      },
    ];
  }

  const itemLines = state.cart.map((line) => {
    const item = state.menu.find((m) => m.dishId === line.dishId);
    if (!item) return `*${line.qty}×*   •   _(unknown)_`;
    return `*${line.qty}×*   ${item.emoji.unicode}   *${item.name}*   —   ${eur(item.price * line.qty)}`;
  });

  const subtotal = state.cart.reduce((s, l) => {
    const item = state.menu.find((m) => m.dishId === l.dishId);
    return s + (item ? item.price * l.qty : 0);
  }, 0);

  const deliveryFee = state.activeRestaurant?.deliveryFee ?? 0;
  const minOrder = state.activeRestaurant?.minOrder ?? 0;
  const total = subtotal + deliveryFee;
  const underMin = minOrder > 0 && subtotal < minOrder;
  const itemCount = state.cart.reduce((n, l) => n + l.qty, 0);

  const blocks: Block[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `🛒  *Your cart at ${restaurantName}*\n_${itemCount} item${itemCount === 1 ? "" : "s"} · tap reactions above to add or remove_`,
      },
    },
    { type: "divider" },
    {
      type: "section",
      text: { type: "mrkdwn", text: itemLines.join("\n") },
    },
    { type: "divider" },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Subtotal*\n${eur(subtotal)}` },
        { type: "mrkdwn", text: `*Delivery*\n${eur(deliveryFee)}` },
      ],
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*TOTAL*\n*${eur(total)}*` },
        {
          type: "mrkdwn",
          text: minOrder > 0
            ? `*Minimum*\n${eur(minOrder)}  ${underMin ? "✗" : "✓"}`
            : `*Minimum*\n—`,
        },
      ],
    },
    { type: "divider" },
  ];

  if (underMin) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `:warning:  Add *${eur(minOrder - subtotal)}* more to reach the minimum order.`,
        },
      ],
    });
  }

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        style: "primary",
        text: { type: "plain_text", text: "🛒  Order now", emoji: true },
        action_id: "place_order",
        value: sessionKey,
      },
      {
        type: "button",
        text: { type: "plain_text", text: "Cancel", emoji: true },
        action_id: "cancel_session",
        value: sessionKey,
        style: "danger",
      },
    ],
  });

  return blocks;
}

/**
 * Single message that morphs in place through the cart-build stages. Visual
 * progress bar uses Unicode circles so it renders identically in dark + light
 * Slack themes without needing a custom emoji.
 */
type ProgressStage = "connecting" | "navigating" | "adding" | "done" | "failed";

function progressBar(currentStep: number, totalSteps: number, width = 18): string {
  const ratio = totalSteps === 0 ? 0 : Math.max(0, Math.min(1, currentStep / totalSteps));
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  const pct = Math.round(ratio * 100);
  return `\`${"▰".repeat(filled)}${"▱".repeat(empty)}\`  ${pct}%`;
}

function rawProgressBar(pct: number, width = 18): string {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const filled = Math.round((clamped / 100) * width);
  return `\`${"▰".repeat(filled)}${"▱".repeat(width - filled)}\`  ${clamped}%`;
}

/** Braille spinner — advances every frame so the card always reads as "working". */
export const BUILD_SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * A bar that's alive even when the percentage isn't changing: solid cells for
 * progress, and a single medium-shade "comet" that travels through the
 * remaining empty cells each frame. Full-cell block glyphs (█ ▓ ░) keep every
 * cell the same monospace width so the bar never jitters.
 */
function animatedBar(pct: number, frame: number, width = 18): string {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const filled = Math.max(0, Math.min(width, Math.round((clamped / 100) * width)));
  const cells: string[] = [];
  for (let i = 0; i < width; i++) cells.push(i < filled ? "█" : "░");
  const emptyLen = width - filled;
  if (emptyLen > 0) {
    cells[filled + (frame % emptyLen)] = "▓"; // comet sweeps the empty region
  } else {
    cells[width - 1] = frame % 2 === 0 ? "█" : "▓"; // bar full — pulse the tail
  }
  return `\`${cells.join("")}\`  ${clamped}%`;
}

/**
 * In-progress card for the cart build. Driven by a ticker (see startBuildTicker)
 * that re-renders on an interval, advancing `frame` so the spinner + comet keep
 * moving and `subtitle` reflects the live sub-step.
 */
export function buildTickBlocks(opts: {
  spinner: string;
  title: string;
  subtitle: string;
  pct: number;
  frame: number;
}): Block[] {
  return [
    {
      type: "section",
      text: { type: "mrkdwn", text: `*${opts.spinner}  ${opts.title}*\n${opts.subtitle}` },
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: animatedBar(opts.pct, opts.frame) }],
    },
  ];
}

/**
 * Compact "looking up…" card used during the (slow) restaurant/menu scrapes.
 * Reads as a status banner with a live-ticking progress bar — the same visual
 * language as the cart-build progress, so the whole flow feels continuous.
 */
export function lookupBlocks(opts: { title: string; subtitle?: string; pct: number }): Block[] {
  const blocks: Block[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `🔎  *${opts.title}*${opts.subtitle ? `\n${opts.subtitle}` : ""}`,
      },
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: rawProgressBar(opts.pct) }],
    },
  ];
  return blocks;
}

export function progressCardBlocks(opts: {
  restaurantName: string;
  stage: ProgressStage;
  detail?: string;
  current?: number;
  total?: number;
  payUrl?: string;
  failedItems?: string[];
}): Block[] {
  const { restaurantName, stage, detail, current = 0, total = 0, payUrl, failedItems = [] } = opts;

  // Steps: connect (1) + open (1) + each item (total) = 2 + total
  const totalSteps = Math.max(3, 2 + (total || 1));
  let currentStep = 0;
  let title: string;
  let subtitle: string;
  switch (stage) {
    case "connecting":
      currentStep = 1;
      title = "👋  Foody's heading to the kitchen…";
      subtitle = `Calling *${restaurantName}* on your behalf.`;
      break;
    case "navigating":
      currentStep = 2;
      title = "👩‍🍳  Foody's in the kitchen…";
      subtitle = `Tying the apron at *${restaurantName}*.`;
      break;
    case "adding":
      currentStep = 2 + current;
      title = `🥘  Plating your order  (${current}/${total})`;
      subtitle = detail ? `Adding *${detail}* to the basket.` : `Plating ${total} dish${total === 1 ? "" : "es"}.`;
      break;
    case "done":
      currentStep = totalSteps;
      title = "🎉  Your basket is ready!";
      subtitle = `Everything's queued at *${restaurantName}*. One tap and you're at checkout.`;
      break;
    case "failed":
      currentStep = 2 + (current ?? 0);
      title = "😬  A couple of dishes slipped";
      subtitle = detail ?? "These didn't make it onto the tray — the rest is good to go.";
      break;
  }

  const blocks: Block[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: `*${title}*\n${subtitle}` },
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: progressBar(currentStep, totalSteps) }],
    },
  ];

  if (stage === "failed" && failedItems.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Didn't add:*\n• ${failedItems.join("\n• ")}`,
      },
    });
  }

  if (stage === "done" || stage === "failed") {
    if (payUrl) {
      blocks.push({ type: "divider" });
      blocks.push({
        type: "actions",
        elements: [
          {
            // NOT a url button — a url button opens Slack's *default* browser,
            // a different Chrome profile than the one Foody built the basket in
            // (empty there). This action surfaces the Foody Chrome tab that
            // actually holds the basket.
            type: "button",
            style: "primary",
            text: { type: "plain_text", text: "💳  Review & pay", emoji: true },
            action_id: "review_and_pay",
            value: payUrl,
          },
        ],
      });
    }
  }

  return blocks;
}

export function receiptBlocks(opts: {
  orderId: string;
  restaurantName: string;
  address: string;
  lines: { name: string; qty: number; lineTotal: number; emoji?: string | null }[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  etaMin: number;
}): Block[] {
  const dishLines = opts.lines
    .map((l) => `*${l.qty}×*   ${l.emoji ?? "•"}   *${l.name}*   —   ${eur(l.lineTotal)}`)
    .join("\n");
  return [
    {
      type: "header",
      text: { type: "plain_text", text: "🎉 Order placed!", emoji: true },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `Order *${opts.orderId}* at *${opts.restaurantName}*\n\n${dishLines}`,
      },
    },
    { type: "divider" },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Subtotal*\n${eur(opts.subtotal)}` },
        { type: "mrkdwn", text: `*Delivery*\n${eur(opts.deliveryFee)}` },
        { type: "mrkdwn", text: `*Total*\n${eur(opts.total)}` },
        { type: "mrkdwn", text: `*ETA*\n~${opts.etaMin} min` },
      ],
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `📍 ${opts.address}` }],
    },
  ];
}
