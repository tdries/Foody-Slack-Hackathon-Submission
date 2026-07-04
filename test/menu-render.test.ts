import { describe, it, expect } from "vitest";
import { emojiPrefsFor } from "../src/scrape-live";
import { assignUniqueEmojis, FALLBACK_EMOJIS } from "../src/emojis";
import { menuCartBlocks, restaurantsBlocks } from "../src/slack/blocks";

const NUMBERED = new Set(FALLBACK_EMOJIS.map((e) => e.slack));
const assign = (names: string[]) =>
  assignUniqueEmojis(names.map((n) => ({ thematicPrefs: emojiPrefsFor(null, n) })));

describe("emoji coverage (regression: menus showed 1️⃣ 2️⃣ badges)", () => {
  it.each([
    [["Salmon Nigiri (6)", "Spicy Tuna Roll", "Dragon Roll", "Tempura Prawns (5)", "Chicken Teriyaki Bento", "Gyoza (5 pcs)", "Sashimi Mix (12)", "Edamame", "California Roll", "Mochi Trio"]],
    [["Pizza Margherita DOP", "Gnocchi Sorrentina", "Tagliatelle al Ragù", "Saltimbocca", "Tiramisù Casalingo", "Caprese di Bufala", "Burrata Pugliese", "Panna Cotta", "Risotto ai Funghi", "Vitello Tonnato"]],
    [["Portie friet", "Portie pepers", "COCA-COLA Coke Soft drink SLEEKCAN 330 ML", "Red Bull Energiedrank 250 ml", "Ice tea"]],
    [["Nuges tinder", "Margherita", "Spaghetti pollo", "Prosciutto", "Squids"]],
    [Array.from({ length: 10 }, (_, i) => `Completely unmatchable dish ${i + 1}`)],
  ])("assigns zero numbered badges to a real-world menu", (names) => {
    const out = assign(names);
    const numbered = out.filter((e) => NUMBERED.has(e.slack));
    expect(numbered, `numbered: ${names.filter((_, i) => NUMBERED.has(out[i].slack)).join(", ")}`).toHaveLength(0);
    expect(new Set(out.map((e) => e.slack)).size).toBe(out.length); // all unique
  });
});

const mkMenuItem = (i: number, imageUrl?: string) => ({
  emoji: { unicode: "🍕", slack: `e${i}` },
  dishId: `d${i}`,
  name: `Dish ${i}`,
  price: 10,
  imageUrl,
});

const baseState: any = {
  user: "sess_test",
  activeRestaurantName: "Testaurant",
  activeRestaurant: { deliveryFee: 2, minOrder: 10, takeawayUrl: "https://takeaway.com/x" },
  menu: [],
  cart: [],
};

describe("menuCartBlocks", () => {
  it("photo view renders one thumbnail row per dish with a photo", () => {
    const state = { ...baseState, menuView: "photos", menu: [mkMenuItem(1, "https://img/1.png"), mkMenuItem(2)] };
    const blocks: any[] = menuCartBlocks(state, "sess_test");
    expect(blocks.filter((b) => b.accessory?.type === "image")).toHaveLength(1);
    expect(JSON.stringify(blocks)).toContain("toggle_menu_view");
  });

  it("photo view without any photos falls back to grid + notice (regression)", () => {
    const state = { ...baseState, menuView: "photos", menu: [mkMenuItem(1), mkMenuItem(2)] };
    const json = JSON.stringify(menuCartBlocks(state, "sess_test"));
    expect(json).toContain("No food images available");
    expect(json).not.toContain("toggle_menu_view"); // no dead toggle
  });

  it("labels demo-data menus (regression: silent mock fallback)", () => {
    const state = { ...baseState, activeRestaurant: { deliveryFee: 2, minOrder: 10 }, menu: [mkMenuItem(1)] };
    expect(JSON.stringify(menuCartBlocks(state, "sess_test"))).toContain("Showing demo data");
  });

  it("stays under Slack's 50-block limit with a full 10-dish photo menu", () => {
    const menu = Array.from({ length: 10 }, (_, i) => mkMenuItem(i, `https://img/${i}.png`));
    const state = { ...baseState, menuView: "photos", menu, cart: [{ dishId: "d1", qty: 2 }] };
    expect(menuCartBlocks(state, "sess_test").length).toBeLessThanOrEqual(50);
  });
});

describe("restaurantsBlocks", () => {
  const mock = (id: string): any => ({ id, name: id, cuisine: "x", rating: 4, reviewCount: 10, deliveryTimeMin: 30, deliveryFee: 2, minOrder: 10, postcodes: [] });

  it("labels all-mock listings as demo data, leaves live listings clean", () => {
    expect(JSON.stringify(restaurantsBlocks("a", [mock("rest-1")], "s"))).toContain("Showing demo data");
    expect(JSON.stringify(restaurantsBlocks("a", [{ ...mock("rest-live-1"), takeawayUrl: "https://t" }], "s"))).not.toContain("Showing demo data");
  });
});

describe("addressMatchesSuggestion (regression: '2nd street new york' scraped Arlon)", () => {
  it("rejects suggestions sharing no token with the input", async () => {
    const { addressMatchesSuggestion } = await import("../src/scrape-live");
    expect(addressMatchesSuggestion("2nd street new york", "Arlon, Belgium")).toBe(false);
    expect(addressMatchesSuggestion("Times Square NYC", "Rue de la Gare, Neufchâteau")).toBe(false);
  });
  it("accepts real fuzzy matches", async () => {
    const { addressMatchesSuggestion } = await import("../src/scrape-live");
    expect(addressMatchesSuggestion("meir 1 antwerpen", "Meir 1, 2000 Antwerpen")).toBe(true);
    expect(addressMatchesSuggestion("Dorp 48, 2230 Herselt", "Dorp 48, 2230 Herselt, België")).toBe(true);
    expect(addressMatchesSuggestion("dorp 48 herselt", "Dorp, Herselt")).toBe(true);
  });
});
