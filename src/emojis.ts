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

/**
 * Per-dish ordered emoji preferences. Returns multiple candidate Slack emoji
 * names so that several variants of the same dish family (e.g. 5 pizzas) can
 * each get a distinct, semantically meaningful emoji rather than collapsing to
 * the same one and falling back to 1️⃣ 2️⃣ 3️⃣.
 *
 * Tests run in order: SPECIFIC (toppings, ingredients, signature dishes) →
 * GENERIC (dish family) → FALLBACK. Each match appends to the prefs list,
 * deduped, so a single dish accumulates multiple options. Example:
 *   "Pizza Funghi"        → [mushroom, pizza, pie]
 *   "Pizza Peperoni"      → [hot_pepper, pizza, pie]
 *   "Pizza Margherita"    → [tomato, cheese_wedge, pizza, pie]
 *   "Pizza ananas"        → [pineapple, pizza, pie]
 *
 * assignUniqueEmojis() walks each dish's prefs and picks the first option not
 * already used — so collisions only fall to numeric badges when an entire
 * preference chain is exhausted.
 */
export function emojiPrefsFor(category: string | null, name: string): string[] {
  const lower = `${category ?? ""} ${name}`.toLowerCase();
  const prefs: string[] = [];
  const add = (slack: string): void => {
    if (!prefs.includes(slack)) prefs.push(slack);
  };

  // ---- Most specific signals first: a single ingredient or signature
  // topping/style is the best representation we can give a variant of a
  // generic dish family.
  if (/peperoni|diavola|piri|chili|chili pepper|spicy|hot pepper|pikant/.test(lower)) add("hot_pepper");
  if (/funghi|mushroom|champignon|truff|tartufo/.test(lower)) add("mushroom");
  if (/hawai|ananas|pineapple/.test(lower)) add("pineapple");
  if (/cipolla|^onion|\buien\b/.test(lower)) add("onion");
  if (/bacon|spek|pancetta/.test(lower)) add("bacon");
  if (/margherita|marinara|pomodoro|tomato|tomaat|tomate/.test(lower)) add("tomato");
  if (/4 ?form|quattro|four cheese|formaggi|cheese\b|cheddar|mozzar|kaas/.test(lower)) add("cheese_wedge");
  if (/carbonar/.test(lower)) add("bacon");
  if (/bolognese|bolognaise|ragu|ragout|gehakt/.test(lower)) add("cut_of_meat");
  if (/vegetar|veggie|vegan|vega\b|sla\b|salade|salad|rucola|rocket|spinach|spinazie/.test(lower)) add("leafy_green");
  if (/pesto|basil|herb|kruiden/.test(lower)) add("herb");
  if (/chicken|wing|poulet|kip\b|poultry/.test(lower)) add("poultry_leg");
  if (/fish|salmon|tuna|cod|zalm|tonijn|kabeljauw|vis\b/.test(lower)) add("fish");
  if (/shrimp|prawn|garnaal|gambas|scampi/.test(lower)) add("shrimp");
  if (/egg|omelet|^ei|\beieren\b/.test(lower)) add("fried_egg");
  if (/kroket|croquette|bitterbal/.test(lower)) add("fried_shrimp");
  if (/dumpling|gyoza|ravio|tortelli/.test(lower)) add("dumpling");
  if (/curry|tikka|masala/.test(lower)) add("curry");
  if (/rice|risotto|paella|nasi|rijst/.test(lower)) add("rice");
  if (/pannenkoek|pancake|crepe|crêpe|wafel|waffle/.test(lower)) add("pancakes");
  if (/coffee|cappuc|espresso|latte|koffie/.test(lower)) add("coffee");
  if (/ice ?cream|sorbet|sundae|ijs\b/.test(lower)) add("ice_cream");
  if (/dessert|tiramis|panna|gelato|cake|brownie|gebak|taart/.test(lower)) add("cake");

  // ---- Dish-family generics. These are the "if nothing more specific
  // matched" emoji for the whole category. Note we add fries BEFORE pizza so
  // "Friet speciaal" doesn't accidentally inherit pizza if we ever broaden.
  if (/fries|frites|friet|frieten|patat|kapsalon/.test(lower)) add("fries");
  if (/burger|cheeseburger|hamburger|bicky|smash/.test(lower)) add("hamburger");
  if (/kebab|kebap|döner|doner|dürüm|durum|shawarma|gyros/.test(lower)) add("meat_on_bone");
  if (/hotdog|hot dog|sausage|cervela|cervelat|frikandel|worst|saucisse|bratwurst/.test(lower)) add("hotdog");
  if (/pizza|calzone/.test(lower)) add("pizza");
  if (/pasta|spaghet|tagliat|gnocch|penne|fettuc/.test(lower)) add("spaghetti");
  if (/lasagn|quiche|tart/.test(lower)) add("pie");
  if (/sushi|sashimi|maki|nigiri/.test(lower)) add("sushi");
  if (/ramen|noodle|pho|udon|noedel/.test(lower)) add("ramen");
  if (/taco|burrito|enchilada|nacho|wrap/.test(lower)) add("taco");
  if (/sandwich|panini|bagel|broodje|sub\b/.test(lower)) add("sandwich");
  if (/bread|baguette|focaccia|naan|brood\b|stokbrood/.test(lower)) add("bread");
  if (/menu|combo|deal|formule|schotel/.test(lower)) add("bento");
  if (/drink|coca|sprite|fanta|water|cola|juice|soda|frisdrank|limonade/.test(lower)) add("glass_of_milk");

  // ---- Family decoratives. When several dishes of the same family appear
  // and the family's primary emoji is already taken (e.g. five plain pizzas
  // with no topping signal), these expand the fallback pool with on-theme
  // emojis instead of numbered badges. Order = preferred-when-needed.
  if (/pizza|calzone/.test(lower)) {
    for (const e of ["tomato", "cheese_wedge", "mushroom", "hot_pepper", "pineapple", "onion", "herb", "spaghetti", "bacon", "fish", "shrimp", "poultry_leg", "leafy_green"]) add(e);
  }
  if (/burger|cheeseburger|hamburger|bicky|smash/.test(lower)) {
    for (const e of ["cheese_wedge", "bacon", "sandwich", "leafy_green", "tomato", "onion", "poultry_leg"]) add(e);
  }
  if (/kebab|kebap|döner|doner|dürüm|durum|shawarma|gyros/.test(lower)) {
    for (const e of ["stuffed_flatbread", "cut_of_meat", "poultry_leg", "hot_pepper", "sandwich", "onion", "tomato"]) add(e);
  }
  if (/pasta|spaghet|tagliat|gnocch|penne|fettuc/.test(lower)) {
    for (const e of ["spaghetti", "tomato", "cheese_wedge", "mushroom", "bacon", "herb", "shrimp"]) add(e);
  }
  if (/sushi|sashimi|maki|nigiri/.test(lower)) {
    for (const e of ["sushi", "fish", "shrimp", "rice_ball", "rice"]) add(e);
  }
  if (/burrito|taco|enchilada|nacho|wrap/.test(lower)) {
    for (const e of ["taco", "burrito", "hot_pepper", "cheese_wedge", "leafy_green"]) add(e);
  }
  if (/fries|frites|friet|frieten|patat|kapsalon/.test(lower)) {
    for (const e of ["fries", "hotdog", "cheese_wedge", "bacon", "corn"]) add(e);
  }
  if (/broodje|sandwich|panini|baguette/.test(lower)) {
    for (const e of ["sandwich", "bread", "cheese_wedge", "bacon", "poultry_leg", "leafy_green"]) add(e);
  }
  if (/hotdog|sausage|cervela|cervelat|frikandel|worst|saucisse|bratwurst/.test(lower)) {
    for (const e of ["hotdog", "meat_on_bone", "cut_of_meat", "bacon", "bread"]) add(e);
  }
  if (/chicken|wing|poulet|kip\b|poultry/.test(lower)) {
    for (const e of ["poultry_leg", "meat_on_bone", "cut_of_meat", "bacon"]) add(e);
  }
  if (/salad|salade|sla\b|bowl|poké|poke/.test(lower)) {
    for (const e of ["leafy_green", "herb", "tomato", "cucumber", "avocado", "shrimp"]) add(e);
  }

  // ---- Generic food spillover. Appended to EVERY dish so that when a menu's
  // specific + family emojis are exhausted (e.g. 10 dishes in one category),
  // dishes grab the next free *food* emoji instead of an ugly numbered badge.
  // assignUniqueEmojis walks these in order and skips ones already taken, so a
  // 10-dish menu effectively never reaches the numeric fallback pool.
  for (const e of [
    "bento", "stew", "curry", "rice", "sandwich", "bread", "fries", "poultry_leg",
    "cut_of_meat", "meat_on_bone", "fish", "shrimp", "dumpling", "cheese_wedge",
    "tomato", "mushroom", "leafy_green", "hot_pepper", "corn", "avocado", "rice_ball",
    "taco", "burrito", "spaghetti", "ramen", "sushi", "hamburger", "pizza", "onion",
    "bacon", "falafel", "stuffed_flatbread", "flatbread", "baguette_bread", "croissant",
    "doughnut", "cucumber", "mango", "pineapple", "hotdog",
  ]) add(e);

  // Universal final fallback so we never return an empty list.
  add("pie");
  return prefs;
}
