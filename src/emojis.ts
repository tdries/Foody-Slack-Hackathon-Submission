/**
 * Emoji palette for Foody.
 *
 * Each dish carries a preferred Slack shortcode in the data file. At menu
 * render time we look up the Unicode codepoint for display, fall back to a
 * numbered emoji if two dishes in the same top-10 happen to want the same
 * shortcode, and emit the shortcode on `reactions.add` / match on
 * `reaction_added`.
 */
export type EmojiPair = { unicode: string; slack: string };

/** Lookup from Slack shortcode (no colons) to Unicode codepoint. */
export const SLACK_TO_UNICODE: Record<string, string> = {
  pizza: "🍕",
  hamburger: "🍔",
  fries: "🍟",
  taco: "🌮",
  burrito: "🌯",
  sushi: "🍣",
  ramen: "🍜",
  bento: "🍱",
  spaghetti: "🍝",
  cheese_wedge: "🧀",
  hot_pepper: "🌶️",
  mushroom: "🍄",
  herb: "🌿",
  pineapple: "🍍",
  pie: "🥧",
  cake: "🍰",
  tomato: "🍅",
  leafy_green: "🥬",
  dumpling: "🥟",
  rice: "🍚",
  takeout_box: "🥡",
  cucumber: "🥒",
  duck: "🦆",
  curry: "🍛",
  cut_of_meat: "🥩",
  stew: "🍲",
  mango: "🥭",
  baguette_bread: "🥖",
  hotdog: "🌭",
  meat_on_bone: "🍖",
  "8ball": "🎱",
  stuffed_flatbread: "🥙",
  croissant: "🥐",
  dragon: "🐉",
  fish: "🐟",
  avocado: "🥑",
  shrimp: "🦐",
  seedling: "🌱",
  rice_ball: "🍙",
  bacon: "🥓",
  poultry_leg: "🍗",
  onion: "🧅",
  chocolate_bar: "🍫",
  bread: "🍞",
  coconut: "🥥",
  doughnut: "🍩",
  falafel: "🧆",
  flatbread: "🫓",
  peanuts: "🥜",
  honey_pot: "🍯",
  tea: "🍵",
  glass_of_milk: "🥛",
  pig: "🐷",
  ice_cream: "🍦",
  sandwich: "🥪",
  coffee: "☕",
  corn: "🌽",
};

/** Reverse lookup, built lazily. */
const UNICODE_TO_SLACK: Record<string, string> = Object.fromEntries(
  Object.entries(SLACK_TO_UNICODE).map(([slack, unicode]) => [unicode, slack]),
);

/** Numbered emojis used when two dishes in the same top-10 want the same shortcode. */
export const FALLBACK_EMOJIS: EmojiPair[] = [
  { slack: "one", unicode: "1️⃣" },
  { slack: "two", unicode: "2️⃣" },
  { slack: "three", unicode: "3️⃣" },
  { slack: "four", unicode: "4️⃣" },
  { slack: "five", unicode: "5️⃣" },
  { slack: "six", unicode: "6️⃣" },
  { slack: "seven", unicode: "7️⃣" },
  { slack: "eight", unicode: "8️⃣" },
  { slack: "nine", unicode: "9️⃣" },
  { slack: "keycap_ten", unicode: "🔟" },
];

export function emojiForSlackName(name: string): EmojiPair | null {
  const u = SLACK_TO_UNICODE[name];
  return u ? { unicode: u, slack: name } : null;
}

export function slackNameForUnicode(unicode: string): string | null {
  return UNICODE_TO_SLACK[unicode] ?? null;
}

/** Per-dish hint: prefer the workspace-uploaded custom emoji if present, else walk the thematic preference list. */
export type DishEmojiHint = {
  /** Slack shortcode (no colons) of an uploaded custom emoji like "foody_margherita". */
  customSlack?: string;
  /** Ordered Slack shortcodes (no colons) — first non-colliding entry wins. */
  thematicPrefs?: string[];
};

/**
 * Resolve one EmojiPair per dish, guaranteed unique within the list.
 *
 * Custom emojis are always preferred when supplied — their names are by
 * construction unique per dish. Otherwise we walk each dish's thematic
 * preference list (most-specific → most-generic) and pick the first option
 * that isn't already taken. Only when an entire preference chain collides do
 * we fall back to FALLBACK_EMOJIS (numbered badges).
 *
 * Example: five pizzas with prefs
 *   Margherita → [tomato, cheese_wedge, pizza, pie]
 *   Cipolla    → [onion, pizza, pie]
 *   Funghi     → [mushroom, pizza, pie]
 *   Peperoni   → [hot_pepper, pizza, pie]
 *   Ananas     → [pineapple, pizza, pie]
 * → each dish picks its first pref (tomato, onion, mushroom, hot_pepper,
 *   pineapple) — no collisions, no numeric badges, all semantically meaningful.
 */
export function assignUniqueEmojis(hints: DishEmojiHint[]): EmojiPair[] {
  const used = new Set<string>();
  const out: EmojiPair[] = [];
  let fallbackIdx = 0;

  for (const h of hints) {
    if (h.customSlack && !used.has(h.customSlack)) {
      used.add(h.customSlack);
      out.push({ unicode: `:${h.customSlack}:`, slack: h.customSlack });
      continue;
    }
    let assigned: EmojiPair | null = null;
    for (const slackName of h.thematicPrefs ?? []) {
      if (used.has(slackName)) continue;
      const candidate = emojiForSlackName(slackName);
      if (!candidate) continue;
      assigned = candidate;
      break;
    }
    if (assigned) {
      used.add(assigned.slack);
      out.push(assigned);
      continue;
    }
    while (fallbackIdx < FALLBACK_EMOJIS.length && used.has(FALLBACK_EMOJIS[fallbackIdx].slack)) {
      fallbackIdx++;
    }
    const fb = FALLBACK_EMOJIS[fallbackIdx] ?? { slack: `none_${out.length}`, unicode: `#${out.length + 1}` };
    used.add(fb.slack);
    out.push(fb);
  }
  return out;
}
