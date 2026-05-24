/**
 * The ten emojis Foody uses to label dishes on a Slack menu card.
 *
 * Each entry has both the Unicode codepoint (for display in message text)
 * and the Slack shortcode name (without colons — for `reactions.add` and the
 * `reaction_added` event payload).
 */
export type DishEmoji = { unicode: string; slack: string };

export const DISH_EMOJIS: DishEmoji[] = [
  { unicode: "🍕", slack: "pizza" },
  { unicode: "🍔", slack: "hamburger" },
  { unicode: "🍟", slack: "fries" },
  { unicode: "🌮", slack: "taco" },
  { unicode: "🌯", slack: "burrito" },
  { unicode: "🍣", slack: "sushi" },
  { unicode: "🍜", slack: "ramen" },
  { unicode: "🍱", slack: "bento" },
  { unicode: "🥗", slack: "green_salad" },
  { unicode: "🍝", slack: "spaghetti" },
];

export function emojiForIndex(i: number): string {
  return DISH_EMOJIS[i]?.unicode ?? `#${i + 1}`;
}

export function dishEmojiForIndex(i: number): DishEmoji | null {
  return DISH_EMOJIS[i] ?? null;
}

/** Normalise a user's emoji input (handles VS16 selector etc.). */
export function normaliseEmoji(input: string): string {
  return input.replace(/️/g, "").trim();
}

export function matchMenuEmoji(input: string, menuEmojis: string[]): string | null {
  const target = normaliseEmoji(input);
  for (const e of menuEmojis) {
    if (normaliseEmoji(e) === target) return e;
  }
  return null;
}

/** Map a Slack reaction shortcode (e.g. "pizza") back to the Unicode emoji we stored on the menu line. */
export function unicodeForSlackName(name: string): string | null {
  const match = DISH_EMOJIS.find((e) => e.slack === name);
  return match ? match.unicode : null;
}
