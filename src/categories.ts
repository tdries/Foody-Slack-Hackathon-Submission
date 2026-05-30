/**
 * Cuisine categories for the Foody Slack picker.
 *
 * Each category has a stable id (used as the action value), a display label
 * with a leading emoji, and a regex used to match a restaurant card's text
 * (cuisine field + name + body copy) when filtering listings on takeaway.com.
 *
 * Keep this list short and visually scannable — Slack action blocks render
 * best with 6-8 buttons before they start wrapping awkwardly.
 */

export type Category = {
  id: string;
  label: string;
  emoji: string;
  /** Match against the lowercased card text of a restaurant listing. */
  match: RegExp;
};

export const CATEGORIES: Category[] = [
  { id: "pizza", emoji: "🍕", label: "Pizza", match: /pizza|margher|diavol|calzone|italiaans|italian/i },
  { id: "burgers", emoji: "🍔", label: "Burgers", match: /burger|cheeseburger|bicky|smash/i },
  { id: "kebab", emoji: "🥙", label: "Kebab", match: /kebab|kebap|döner|doner|dürüm|durum|shawarma|gyros|turkish|turks/i },
  { id: "sushi", emoji: "🍣", label: "Sushi", match: /sushi|sashimi|maki|nigiri|japanese|japans/i },
  { id: "asian", emoji: "🍜", label: "Asian", match: /asian|aziatisch|chinese|chinees|thai|thais|vietnamese|vietnamees|korean|noodle|noedel|ramen|pho|wok/i },
  { id: "italian", emoji: "🍝", label: "Italian", match: /italian|italiaans|pasta|spaghet|gnocch|tagliat|lasagn|risotto/i },
  { id: "belgian", emoji: "🌭", label: "Belgian", match: /belgian|friet|frieten|snack|frituur|brasserie|kapsalon|frikandel|cervela/i },
  { id: "healthy", emoji: "🥗", label: "Healthy", match: /salad|salade|vegan|vegetar|veggie|poké|poke|healthy|gezond|bowl/i },
];

export function categoryById(id: string): Category | null {
  return CATEGORIES.find((c) => c.id === id) ?? null;
}
