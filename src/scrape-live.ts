/**
 * Live takeaway.com scraping for "what's near me?" + "what's on this menu?".
 *
 * Uses a single long-lived headless puppeteer browser (kept alive between
 * calls) so each scrape only pays for a new tab, not a fresh launch. Falls
 * back gracefully — every exported function throws on failure and the caller
 * (takeaway.ts) catches and reverts to static data.
 *
 * This is intentionally separate from src/checkout.ts: that one drives the
 * USER's own Chrome via puppeteer.connect, because cart-build must happen in
 * their signed-in session. Scraping doesn't need a session, so we run our own
 * headless browser to avoid taking over the user's tabs.
 */
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Restaurant, Dish } from "./takeaway.ts";
import { categoryById } from "./categories.ts";

puppeteer.use(StealthPlugin());

let cachedBrowser: any = null;

async function getBrowser() {
  if (cachedBrowser) {
    // puppeteer 22+ exposes `.connected` (property); older builds had
    // `.isConnected()` (method). Accept either.
    const alive =
      typeof cachedBrowser.connected === "boolean"
        ? cachedBrowser.connected
        : typeof cachedBrowser.isConnected === "function"
          ? cachedBrowser.isConnected()
          : true;
    if (alive) return cachedBrowser;
    cachedBrowser = null;
  }
  cachedBrowser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });
  return cachedBrowser;
}

async function dismissCookies(page: any) {
  await new Promise((r) => setTimeout(r, 700));
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button")) as HTMLButtonElement[];
    const accept = btns.find((b) =>
      /accept all|alles accepter|alle accepteren|akkoord/i.test(b.textContent ?? ""),
    );
    accept?.click();
  });
  await new Promise((r) => setTimeout(r, 500));
}

async function setAddress(page: any, address: string) {
  await page.goto("https://www.takeaway.com/be-en", { waitUntil: "networkidle2", timeout: 60_000 });
  await dismissCookies(page);
  const input = await page.$('input[name="searchText"]');
  if (!input) throw new Error("address input not found on homepage");
  await input.click({ clickCount: 3 });
  await page.keyboard.press("Backspace");
  await page.type('input[name="searchText"]', address, { delay: 70 });
  await page.waitForSelector('[role="option"]', { timeout: 8000 });
  await new Promise((r) => setTimeout(r, 500));
  await page.evaluate(() => (document.querySelector('[role="option"]') as HTMLElement | null)?.click());
  await new Promise((r) => setTimeout(r, 4000));
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
function emojiPrefsFor(category: string | null, name: string): string[] {
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

  // Universal final fallback so we never return an empty list.
  add("pie");
  return prefs;
}

async function resetBrowser() {
  if (cachedBrowser) {
    try { await cachedBrowser.close(); } catch {}
    cachedBrowser = null;
  }
}

/** Runs a scrape op, and if it throws (detached frame, dead browser, etc.) close the cached browser and try once more with a fresh one. */
async function withRetry<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (/detached|disconnect|Target closed|browser has disconnected|isConnected/i.test(msg)) {
      await resetBrowser();
      return await op();
    }
    throw err;
  }
}

export async function scrapeListings(
  address: string,
  limit = 3,
  categoryId?: string | null,
): Promise<Restaurant[]> {
  return withRetry(() => scrapeListingsOnce(address, limit, categoryId ?? null));
}

async function scrapeListingsOnce(
  address: string,
  limit: number,
  categoryId: string | null,
): Promise<Restaurant[]> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  try {
    await setAddress(page, address);

    // When filtering by category, we need a bigger candidate pool to pick the
    // top `limit` matches from. ~40 cards covers most cuisines on a populated
    // listings page; no filter → just take the first `limit`.
    const scanLimit = categoryId ? 40 : limit;
    const items: Array<{
      slug: string;
      href: string;
      name: string;
      cuisine: string | null;
      rating: number | null;
      reviewCount: number | null;
      deliveryTimeMin: number | null;
      deliveryFee: number | null;
      minOrder: number | null;
      text: string;
    }> = await page.evaluate((scanLimit: number) => {
      // @ts-ignore — esbuild (tsx) emits __name() calls for named arrows; shim in the browser.
      if (typeof (globalThis as any).__name !== "function") (globalThis as any).__name = (fn: any) => fn;
      const anchors = Array.from(document.querySelectorAll('a[href*="/be-en/menu/"]')) as HTMLAnchorElement[];
      const seen = new Set<string>();
      const result: any[] = [];
      for (const a of anchors) {
        if (result.length >= scanLimit) break;
        const href = a.href;
        const slugMatch = href.match(/\/be-en\/menu\/([^/?#]+)/);
        if (!slugMatch) continue;
        const slug = slugMatch[1];
        if (seen.has(slug)) continue;
        seen.add(slug);

        // The card content is usually inside a parent of the anchor (or the anchor itself).
        const card: HTMLElement = (a.closest("article, [data-qa], li") as HTMLElement) ?? a;
        const text = (card.textContent ?? "").replace(/\s+/g, " ").trim();

        // Name: prefer headings inside the card
        const name =
          ((card.querySelector("h2, h3, [class*='Name'], [class*='name']") as HTMLElement | null)?.textContent ?? "")
            .trim()
            .split("\n")[0] ||
          (a.textContent ?? "").replace(/\s+/g, " ").trim().split(" — ")[0]?.slice(0, 60) ||
          slug;

        // Cuisine hint (a comma-or-bullet-separated list right after the name)
        const cuisineMatch = text.match(/(?:Italian|Pizza|Burger|Sushi|Asian|Vietnamese|Indian|Thai|Mexican|Lebanese|Greek|Belgian|Vegetarian|Vegan|American|Mediterranean|Chinese|Japanese|French|Turkish|Korean|Spanish|Sandwiches?|Salads?|Desserts?)/i);
        const cuisine = cuisineMatch ? cuisineMatch[0] : null;

        // Heuristic field extraction from text
        const ratingMatch = text.match(/(\d\.\d)\s*(?:\(|\/|out of|stars?|★)/i) ?? text.match(/\b([3-5]\.\d)\b/);
        const reviewMatch = text.match(/\((\d{2,5})\)/);
        const deliveryRange = text.match(/(\d{1,3})\s*[-–]\s*(\d{1,3})\s*min/i);
        const deliverySingle = text.match(/(\d{1,3})\s*min/i);
        const feeMatch = text.match(/(?:delivery|fee|levering)[^€]*€\s?(\d+[.,]\d{2})/i) ?? text.match(/€\s?(\d+[.,]\d{2}).*delivery/i);
        const minMatch = text.match(/(?:min(?:imum)?|minorder)[^€]*€\s?(\d+[.,]?\d{0,2})/i);

        result.push({
          slug,
          href,
          name,
          cuisine,
          rating: ratingMatch ? Number(ratingMatch[1]) : null,
          reviewCount: reviewMatch ? Number(reviewMatch[1]) : null,
          deliveryTimeMin: deliveryRange ? Number(deliveryRange[2]) : deliverySingle ? Number(deliverySingle[1]) : null,
          deliveryFee: feeMatch ? Number(feeMatch[1].replace(",", ".")) : null,
          minOrder: minMatch ? Number(minMatch[1].replace(",", ".")) : null,
          text,
        });
      }
      return result;
    }, scanLimit);

    // Category filter: match against name + cuisine + body text. If the
    // filter rejects everything, fall back silently to the unfiltered top
    // results so the user always gets *something*.
    let pool = items;
    if (categoryId) {
      const cat = categoryById(categoryId);
      if (cat) {
        const matched = items.filter((r) =>
          cat.match.test(`${r.name} ${r.cuisine ?? ""} ${r.text}`),
        );
        if (matched.length > 0) pool = matched;
      }
    }

    // Rank by rating (desc), then review count, then a slight bias for cards
    // whose name itself contains the category keyword (stronger signal than a
    // body-text mention).
    const cat = categoryId ? categoryById(categoryId) : null;
    const nameHit = (r: typeof items[number]) =>
      cat ? (cat.match.test(r.name) ? 1 : 0) : 0;
    const ranked = [...pool].sort((a, b) => {
      if (nameHit(b) !== nameHit(a)) return nameHit(b) - nameHit(a);
      const ra = a.rating ?? 0;
      const rb = b.rating ?? 0;
      if (rb !== ra) return rb - ra;
      return (b.reviewCount ?? 0) - (a.reviewCount ?? 0);
    });

    return ranked.slice(0, limit).map((r, i) => ({
      id: `rest-live-${r.slug}`,
      name: r.name,
      cuisine: r.cuisine ?? "Restaurant",
      rating: r.rating ?? 4.6 - i * 0.1,
      reviewCount: r.reviewCount ?? 100,
      deliveryTimeMin: r.deliveryTimeMin ?? 35,
      deliveryFee: r.deliveryFee ?? 2.99,
      minOrder: r.minOrder ?? 10,
      postcodes: [],
      takeawayUrl: r.href,
      isReal: true,
    })) as Restaurant[];
  } finally {
    await page.close().catch(() => {});
  }
}

export async function scrapeMenu(
  restaurantUrl: string,
  restaurantId: string,
  limit = 10,
): Promise<Dish[]> {
  return withRetry(() => scrapeMenuOnce(restaurantUrl, restaurantId, limit));
}

async function scrapeMenuOnce(
  restaurantUrl: string,
  restaurantId: string,
  limit: number,
): Promise<Dish[]> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  try {
    await page.goto(restaurantUrl, { waitUntil: "networkidle2", timeout: 60_000 });
    await dismissCookies(page);
    await new Promise((r) => setTimeout(r, 2000));

    // Scroll the page a bit so lazy-loaded popular items render.
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        let total = 0;
        const step = 600;
        const id = setInterval(() => {
          window.scrollBy(0, step);
          total += step;
          if (total >= Math.min(4000, document.documentElement.scrollHeight)) {
            clearInterval(id);
            resolve();
          }
        }, 150);
      });
    });
    await new Promise((r) => setTimeout(r, 800));

    const dishes: Array<{ name: string; price: number; category: string | null; takeawayDishId: string | null }> =
      await page.evaluate(() => {
        // @ts-ignore — defuse esbuild's __name helper in the browser context.
        if (typeof (globalThis as any).__name !== "function") (globalThis as any).__name = (fn: any) => fn;
        // Strategy 1: the Pizza-Roma-shaped popular-items grid (React-hash class).
        let nameNodes = Array.from(
          document.querySelectorAll(".popular-item-style_name__T__oA"),
        ) as HTMLElement[];

        // Strategy 2: generic — any element whose class contains popular-item-style_name.
        if (nameNodes.length === 0) {
          nameNodes = Array.from(
            document.querySelectorAll('[class*="popular-item-style_name"]'),
          ) as HTMLElement[];
        }

        const result: any[] = [];
        for (const nameEl of nameNodes) {
          let card: HTMLElement | null = nameEl;
          for (let i = 0; i < 6 && card && card.getAttribute("data-qa") !== "media"; i++) {
            card = card.parentElement;
          }
          if (!card) continue;
          const name = nameEl.textContent?.trim() ?? "";
          const priceEl =
            card.querySelector('[class*="formatted-currency-style_content"]') ??
            card.querySelector(".formatted-currency-style_content__VNVsV");
          const priceText = priceEl?.textContent?.replace(/\s|&nbsp;/g, "").trim() ?? "";
          const priceMatch = priceText.match(/€?(\d+)[.,](\d{2})/);
          const price = priceMatch ? Number(priceMatch[1]) + Number(priceMatch[2]) / 100 : null;
          const category =
            (card.querySelector('[class*="popular-item-style_category"]') as HTMLElement | null)?.textContent?.trim() ??
            null;
          const img = card.querySelector("img") as HTMLImageElement | null;
          const idMatch = img?.src?.match(/\/dishes\/(\d+)\//);
          const takeawayDishId = idMatch ? idMatch[1] : null;
          if (name && price !== null) {
            result.push({ name, price, category, takeawayDishId });
          }
        }

        // Strategy 2.5 — regular menu list using takeaway's stable data-qa hooks.
        // Pages that don't render a "Highlights" carousel still have one
        // [data-qa="item-name"] per dish, sibling to [data-qa="item-price"]. This
        // is much more robust than the price-walker fallback below, so we run it
        // BEFORE Strategy 3. We also climb a few ancestors to find the section
        // heading (h2/h3) for category info.
        if (result.length === 0) {
          const nameNodes2 = Array.from(
            document.querySelectorAll('[data-qa="item-name"]'),
          ) as HTMLElement[];
          for (const nameEl of nameNodes2) {
            const name = nameEl.textContent?.trim() ?? "";
            if (!name) continue;
            // Climb to a row container that has the price as a descendant. Most
            // takeaway pages wrap the heading + price + description in a single
            // div a few levels up.
            let row: HTMLElement | null = nameEl;
            for (let i = 0; i < 8 && row; i++) {
              if (row.querySelector('[data-qa="item-price"], [class*="formatted-currency-style_content"]')) break;
              row = row.parentElement;
            }
            if (!row) continue;
            const priceEl =
              row.querySelector('[class*="formatted-currency-style_content"]') ??
              row.querySelector(".formatted-currency-style_content__VNVsV");
            const priceText = priceEl?.textContent?.replace(/\s|&nbsp;/g, "").trim() ?? "";
            const priceMatch = priceText.match(/€?(\d+)[.,](\d{2})/);
            const price = priceMatch ? Number(priceMatch[1]) + Number(priceMatch[2]) / 100 : null;
            if (price === null) continue;
            // Walk up further to find the nearest preceding section h2 for category.
            let category: string | null = null;
            let probe: HTMLElement | null = row;
            for (let i = 0; i < 15 && probe; i++) {
              probe = probe.parentElement;
              if (!probe) break;
              const h2 = probe.querySelector("h2");
              if (h2 && h2.textContent && h2.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING) {
                category = h2.textContent.trim();
                break;
              }
            }
            const img = row.querySelector("img") as HTMLImageElement | null;
            const idMatch = img?.src?.match(/\/dishes\/(\d+)\//);
            const takeawayDishId = idMatch ? idMatch[1] : null;
            result.push({ name, price, category, takeawayDishId });
            if (result.length >= 30) break;
          }
        }

        // Strategy 3 (generic fallback): find every price node and walk up to a card
        // ancestor that has a heading/strong element. Used when the popular-items
        // grid isn't visible (e.g. restaurants whose page renders the regular menu
        // list straight away).
        if (result.length === 0) {
          const priceRe = /€\s?\d+[.,]\d{2}/;
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          const priceEls: HTMLElement[] = [];
          while (walker.nextNode()) {
            const t = walker.currentNode.textContent ?? "";
            if (priceRe.test(t) && t.trim().length < 30) {
              const p = walker.currentNode.parentElement;
              if (p) priceEls.push(p);
            }
          }
          const seenCards = new Set<HTMLElement>();
          for (const pEl of priceEls) {
            let card: HTMLElement | null = pEl;
            for (let d = 0; d < 7 && card; d++) {
              const hasTitle = card.querySelector("h3, h4, [role='heading'], strong");
              if (hasTitle && card !== pEl) break;
              card = card.parentElement;
            }
            if (!card || seenCards.has(card)) continue;
            seenCards.add(card);
            const titleEl =
              (card.querySelector("h3, h4, [role='heading'], strong") as HTMLElement | null) ?? null;
            const name = titleEl?.textContent?.trim() ?? "";
            const priceText = pEl.textContent?.replace(/\s|&nbsp;/g, "").trim() ?? "";
            const priceMatch = priceText.match(/€?(\d+)[.,](\d{2})/);
            const price = priceMatch ? Number(priceMatch[1]) + Number(priceMatch[2]) / 100 : null;
            const img = card.querySelector("img") as HTMLImageElement | null;
            const idMatch = img?.src?.match(/\/dishes\/(\d+)\//);
            const takeawayDishId = idMatch ? idMatch[1] : null;
            if (name && price !== null) {
              result.push({ name, price, category: null, takeawayDishId });
              if (result.length >= 20) break;
            }
          }
        }

        return result;
      });

    const slug = restaurantId.replace(/^rest-live-/, "");
    return dishes.slice(0, limit).map((d, i) => ({
      id: `dish-live-${slug}-${i + 1}-${d.takeawayDishId ?? "noid"}`,
      restaurantId,
      name: d.name,
      description: d.category ?? "",
      price: d.price,
      popularity: 100 - i * 2,
      category: d.category ?? undefined,
      slackEmojiPrefs: emojiPrefsFor(d.category, d.name),
      takeawayDishId: d.takeawayDishId,
      takeawayDishName: d.name,
    })) as Dish[];
  } finally {
    await page.close().catch(() => {});
  }
}
