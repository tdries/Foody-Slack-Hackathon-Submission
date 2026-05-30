#!/usr/bin/env node
/**
 * Scrape Pizza Roma's "Popular items" section on takeaway.com into
 * data/takeaway-real.json so Foody can drive a real order at this
 * restaurant. One-off — re-run if the menu changes.
 *
 * Output shape (compatible with src/takeaway.ts Restaurant + Dish):
 *   {
 *     restaurants: [{
 *       id: "rest-real-pizza-roma",
 *       takeawayUrl: "https://www.takeaway.com/be-en/menu/pizza-roma-4",
 *       ...
 *     }],
 *     dishes: [{
 *       id: "real-pizza-roma-<takeawayDishId>",
 *       restaurantId: "rest-real-pizza-roma",
 *       name, description, price, popularity, slackEmoji,
 *       takeawayDishId,    // numeric id from the cloudinary URL
 *       takeawayDishName,  // exact name string used on the site, for DOM matching
 *     }, ...]
 *   }
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

puppeteer.use(StealthPlugin());

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const ADDRESS = "Veldstraat 1, 9000 Gent";
const RESTAURANT_URL = "https://www.takeaway.com/be-en/menu/pizza-roma-4";
const RESTAURANT_ID = "rest-real-pizza-roma";

async function dismissCookies(page) {
  await new Promise((r) => setTimeout(r, 800));
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")];
    const accept = btns.find((b) => /accept all|alles accepter|alle accepteren/i.test(b.textContent ?? ""));
    accept?.click();
  });
  await new Promise((r) => setTimeout(r, 800));
}

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  // Set address (so menu pages don't redirect to homepage).
  await page.goto("https://www.takeaway.com/be-en", { waitUntil: "networkidle2" });
  await dismissCookies(page);
  await page.click('input[name="searchText"]');
  await page.type('input[name="searchText"]', ADDRESS, { delay: 70 });
  await page.waitForSelector('[role="option"]', { timeout: 8000 });
  await new Promise((r) => setTimeout(r, 500));
  await page.evaluate(() => document.querySelector('[role="option"]')?.click());
  await new Promise((r) => setTimeout(r, 4000));

  // Navigate to the restaurant.
  await page.goto(RESTAURANT_URL, { waitUntil: "networkidle2" });
  await dismissCookies(page);
  await new Promise((r) => setTimeout(r, 2000));

  const data = await page.evaluate(() => {
    const restaurantName = document.querySelector("h1")?.textContent?.trim() ?? "Pizza Roma";

    // Popular items have media cards whose name lives in
    // .popular-item-style_name__T__oA . Description tends to live in
    // .popular-item-style_description__* (varies — grab whatever sibling text exists).
    const nameNodes = [...document.querySelectorAll(".popular-item-style_name__T__oA")];

    const dishes = [];
    for (const nameEl of nameNodes) {
      // Walk up to the card container (the [data-qa="media"] ancestor).
      let card = nameEl;
      for (let i = 0; i < 6 && card && card.getAttribute("data-qa") !== "media"; i++) {
        card = card.parentElement;
      }
      if (!card) continue;

      const name = nameEl.textContent?.trim() ?? "";
      const priceEl = card.querySelector(".formatted-currency-style_content__VNVsV");
      const priceText = priceEl?.textContent?.replace(/\s|&nbsp;/g, "").trim() ?? "";
      const priceMatch = priceText.match(/€?(\d+)[.,](\d{2})/);
      const price = priceMatch ? Number(priceMatch[1]) + Number(priceMatch[2]) / 100 : null;

      const category = card.querySelector(".popular-item-style_category__H2ocU")?.textContent?.trim() ?? null;

      const img = card.querySelector("img");
      const imgSrc = img?.getAttribute("src") ?? null;
      const idMatch = imgSrc?.match(/\/dishes\/(\d+)\//);
      const takeawayDishId = idMatch ? idMatch[1] : null;

      if (name && price !== null) {
        dishes.push({ name, price, category, imgSrc, takeawayDishId });
      }
    }
    return { restaurantName, dishes };
  });

  console.log(`scraped ${data.dishes.length} popular items at ${data.restaurantName}`);
  if (data.dishes.length === 0) {
    console.error("nothing scraped — DOM structure may have changed");
    process.exit(2);
  }

  // Keep top 10. The page seems to list popular items already roughly ranked.
  const top10 = data.dishes.slice(0, 10);

  // Best-effort thematic emoji per category (matches our existing emojis.ts palette).
  function emojiFor(category, name) {
    const lower = `${category ?? ""} ${name}`.toLowerCase();
    if (/pizza|margher|diavol|hawai|funghi|calzone|carbonar/.test(lower)) return "pizza";
    if (/lasagn/.test(lower)) return "pie";
    if (/pasta|spaghet|tagliat|gnocch/.test(lower)) return "spaghetti";
    if (/dessert|tiramis|panna|gelato/.test(lower)) return "cake";
    if (/burger/.test(lower)) return "hamburger";
    if (/salad/.test(lower)) return "leafy_green";
    if (/drink|coca|sprite|fanta|water/.test(lower)) return "glass_of_milk";
    if (/menu|combo|deal/.test(lower)) return "bento";
    return "pie"; // generic fallback that exists in our palette
  }

  const restaurants = [
    {
      id: RESTAURANT_ID,
      name: data.restaurantName,
      cuisine: "Italian",
      rating: 4.6,
      reviewCount: 0,
      deliveryTimeMin: 35,
      deliveryFee: 2.99,
      minOrder: 9,
      postcodes: ["9000", "9050", "9051"],
      takeawayUrl: RESTAURANT_URL,
      isReal: true,
    },
  ];
  const dishes = top10.map((d, i) => ({
    // Always include the index — multiple dishes can share the same Cloudinary
    // placeholder image, so takeawayDishId alone isn't unique within a restaurant.
    id: `real-pr-${i + 1}-${d.takeawayDishId ?? "noid"}`,
    restaurantId: RESTAURANT_ID,
    name: d.name,
    description: d.category ?? "",
    price: d.price,
    popularity: 100 - i * 2,
    category: d.category ?? undefined,
    slackEmoji: emojiFor(d.category, d.name),
    takeawayDishId: d.takeawayDishId,
    takeawayDishName: d.name,
  }));

  const out = { restaurants, dishes };
  const outPath = join(ROOT, "data", "takeaway-real.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
  console.log(`→ ${outPath}`);
  for (const d of dishes) {
    console.log(`  ${d.name.padEnd(40)} €${d.price.toFixed(2)} ${d.takeawayDishId ?? "(no id)"}`);
  }
} finally {
  await browser.close();
}
