/**
 * Pool of emojis used to label dishes on WhatsApp. Each menu render picks the
 * first N to keep ordering stable for one menu session. We bias toward
 * food-ish emojis but fall back to numbers when needed.
 */
export const DISH_EMOJIS: string[] = [
  "🍕",
  "🍔",
  "🍟",
  "🌮",
  "🌯",
  "🍣",
  "🍜",
  "🍱",
  "🥗",
  "🍝",
  "🥘",
  "🍲",
];

export function emojiForIndex(i: number): string {
  return DISH_EMOJIS[i] ?? `#${i + 1}`;
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
