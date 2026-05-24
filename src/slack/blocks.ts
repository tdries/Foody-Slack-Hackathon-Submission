import type { Restaurant } from "../takeaway.ts";
import type { FoodyState, MenuItem } from "../state.ts";

type Block = Record<string, unknown>;

function eur(n: number): string {
  return `€${n.toFixed(2)}`;
}

function stars(rating: number): string {
  const rounded = Math.round(rating * 10) / 10;
  return `⭐ ${rounded.toFixed(1)}`;
}

export function restaurantsBlocks(address: string, restaurants: Restaurant[], sessionKey: string): Block[] {
  const blocks: Block[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "🍴 Top 3 spots near you", emoji: true },
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `📍 *${address}*` }],
    },
    { type: "divider" },
  ];

  for (const r of restaurants) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${r.name}* — ${r.cuisine}\n${stars(r.rating)} (${r.reviewCount}) · ⏱ ${r.deliveryTimeMin} min · 🛵 ${eur(r.deliveryFee)} · min ${eur(r.minOrder)}`,
      },
      accessory: {
        type: "button",
        text: { type: "plain_text", text: "See menu", emoji: true },
        action_id: "pick_restaurant",
        value: JSON.stringify({ restaurantId: r.id, sessionKey }),
      },
    });
  }

  return blocks;
}

export function menuBlocks(
  restaurantName: string,
  menu: MenuItem[],
  sessionKey: string,
): Block[] {
  const lines = menu.map(
    (m) => `${m.emoji}  *${m.name}* — ${eur(m.price)}\n_${m.description ?? ""}_`,
  );

  return [
    {
      type: "header",
      text: { type: "plain_text", text: `🍴 ${restaurantName} — top picks`, emoji: true },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: lines.join("\n\n") },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "👇 *React with the emoji* next to a dish to add it. React again to add more. Remove your reaction to take one out.",
        },
      ],
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          style: "primary",
          text: { type: "plain_text", text: "🛒  Order", emoji: true },
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
    },
  ];
}

export function cartBlocks(state: FoodyState): Block[] {
  if (state.cart.length === 0) {
    return [
      {
        type: "section",
        text: { type: "mrkdwn", text: "🛒 Cart is empty. React with an emoji on the menu above." },
      },
    ];
  }

  const lines = state.cart.map((line) => {
    const item = state.menu.find((m) => m.dishId === line.dishId);
    if (!item) return `• (unknown) × ${line.qty}`;
    return `${item.emoji}  *${item.name}* × ${line.qty} — ${eur(item.price * line.qty)}`;
  });
  const subtotal = state.cart.reduce((s, l) => {
    const item = state.menu.find((m) => m.dishId === l.dishId);
    return s + (item ? item.price * l.qty : 0);
  }, 0);

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `🛒 *Cart at ${state.activeRestaurantName ?? ""}*\n${lines.join("\n")}\n\n*Subtotal:* ${eur(subtotal)}`,
      },
    },
  ];
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
    .map((l) => `${l.emoji ?? "•"}  *${l.name}* × ${l.qty} — ${eur(l.lineTotal)}`)
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
