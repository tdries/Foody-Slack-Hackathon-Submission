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
import { emojiPrefsFor } from "./emojis.ts";
export { emojiPrefsFor };

/**
 * Just Eat Takeaway market to operate in. Two knobs, most specific wins:
 *   FOODY_TAKEAWAY_BASE   — full storefront URL, for sister domains:
 *                           https://www.thuisbezorgd.nl/en (NL),
 *                           https://www.lieferando.de/en (DE)
 *   FOODY_TAKEAWAY_LOCALE — path on takeaway.com itself: be-en (default), lu-en, bg-en
 * Coverage is per-country; JET has no US market — a New York address can never
 * resolve, it falls back to labelled demo data.
 */
const LOCALE = (process.env.FOODY_TAKEAWAY_LOCALE ?? "be-en").trim();
const BASE = (process.env.FOODY_TAKEAWAY_BASE ?? `https://www.takeaway.com/${LOCALE}`).trim().replace(/\/+$/, "");

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
      /accept all|alles accepter|alle accepteren|akkoord|alle akzeptieren|zustimmen/i.test(b.textContent ?? ""),
    );
    accept?.click();
  });
  await new Promise((r) => setTimeout(r, 500));
}

/**
 * takeaway.com's autocomplete fuzzy-matches ANY input to some location —
 * "2nd street new york" happily resolved to Arlon, and we scraped Arlon
 * pizzerias as "near you". Only accept a suggestion that shares at least one
 * real token with what the user typed; otherwise fail the scrape (the caller
 * falls back to clearly-labelled demo data).
 */
export function addressMatchesSuggestion(address: string, suggestion: string): boolean {
  const tokens = address.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  if (tokens.length === 0) return true; // nothing to compare — let it through
  const s = suggestion.toLowerCase();
  return tokens.some((t) => s.includes(t));
}

async function setAddress(page: any, address: string) {
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 60_000 });
  await dismissCookies(page);
  const input = await page.$('input[name="searchText"]');
  if (!input) throw new Error("address input not found on homepage");
  await input.click({ clickCount: 3 });
  await page.keyboard.press("Backspace");
  await page.type('input[name="searchText"]', address, { delay: 70 });
  await page.waitForSelector('[role="option"]', { timeout: 8000 });
  await new Promise((r) => setTimeout(r, 500));
  // The dropdown's first entry is often a "Use your location" geolocation
  // pseudo-option; real address suggestions render below it and can lag a
  // moment behind. Pick the first REAL suggestion, never the pseudo-entry.
  const pickSuggestion = (): Promise<{ idx: number; text: string } | null> =>
    page.evaluate(() => {
      // @ts-ignore — defuse esbuild's __name helper in the browser context.
      if (typeof (globalThis as any).__name !== "function") (globalThis as any).__name = (fn: any) => fn;
      const opts = Array.from(document.querySelectorAll('[role="option"]')) as HTMLElement[];
      const isPseudo = (t: string) =>
        /use your location|use my location|gebruik.*locatie|utiliser ma position|standort verwenden/i.test(t);
      const idx = opts.findIndex((o) => (o.textContent ?? "").trim() && !isPseudo(o.textContent ?? ""));
      return idx === -1 ? null : { idx, text: (opts[idx].textContent ?? "").trim() };
    });
  let suggestion = await pickSuggestion();
  if (!suggestion) {
    await new Promise((r) => setTimeout(r, 1500));
    suggestion = await pickSuggestion();
  }
  if (!suggestion) throw new Error(`no address suggestions appeared for "${address}"`);
  if (!addressMatchesSuggestion(address, suggestion.text)) {
    throw new Error(
      `address "${address}" didn't match a takeaway.com location (closest suggestion: "${suggestion.text}")`,
    );
  }
  await page.evaluate((i: number) => {
    (Array.from(document.querySelectorAll('[role="option"]'))[i] as HTMLElement | undefined)?.click();
  }, suggestion.idx);
  await new Promise((r) => setTimeout(r, 4000));
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
    }> = await page.evaluate(({ scanLimit, locale }: { scanLimit: number; locale: string }) => {
      // @ts-ignore — esbuild (tsx) emits __name() calls for named arrows; shim in the browser.
      if (typeof (globalThis as any).__name !== "function") (globalThis as any).__name = (fn: any) => fn;
      // Locale-agnostic on purpose: this runs in the browser context where the
      // Node-side constants don't exist. Menu links are /<locale>/menu/<slug>
      // on takeaway.com/thuisbezorgd, /speisekarte/<slug> on lieferando.
      const anchors = Array.from(
        document.querySelectorAll('a[href*="/menu/"], a[href*="/speisekarte/"]'),
      ) as HTMLAnchorElement[];
      const seen = new Set<string>();
      const result: any[] = [];
      for (const a of anchors) {
        if (result.length >= scanLimit) break;
        const href = a.href;
        const slugMatch = href.match(/\/(?:menu|speisekarte)\/([^/?#]+)/);
        if (!slugMatch) continue;
        const slug = slugMatch[1];
        if (seen.has(slug)) continue;
        seen.add(slug);

        // The card content is usually inside a parent of the anchor (or the anchor itself).
        const card: HTMLElement = (a.closest("article, [data-qa], li") as HTMLElement) ?? a;
        const text = (card.textContent ?? "").replace(/\s+/g, " ").trim();

        // Name: prefer headings inside the card
        const rawName =
          ((card.querySelector("h2, h3, [class*='Name'], [class*='name']") as HTMLElement | null)?.textContent ?? "")
            .trim()
            .split("\n")[0] ||
          (a.textContent ?? "").replace(/\s+/g, " ").trim().split(" — ")[0]?.slice(0, 60) ||
          slug;
        // Promo carousels (thuisbezorgd/lieferando) leak marketing copy into
        // the heading ("Up to 25% off …Order now"). The URL slug is the
        // restaurant's real name — prefer it when the heading smells like an ad.
        const name =
          /%\s?off|order now|for free|deliveredorder/i.test(rawName) || rawName.length > 60
            ? slug.replace(/-/g, " ").replace(/\b[a-z]/g, (c: string) => c.toUpperCase())
            : rawName;

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
    }, { scanLimit, locale: LOCALE });

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

    // Dish photos are lazy-loaded — walk the page viewport-by-viewport so the
    // IntersectionObserver fires and <img> tags get their real src.
    await page.evaluate(async () => {
      const step = window.innerHeight || 800;
      for (let y = 0; y <= document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 200));
      }
      window.scrollTo(0, 0);
    });
    await new Promise((r) => setTimeout(r, 500));

    const dishes: Array<{ name: string; price: number; category: string | null; takeawayDishId: string | null; imageUrl: string | null }> =
      await page.evaluate(() => {
        // @ts-ignore — defuse esbuild's __name helper in the browser context.
        if (typeof (globalThis as any).__name !== "function") (globalThis as any).__name = (fn: any) => fn;
        // Best-available image URL: loaded src, else the lazy-loader's pending
        // data-src, else the first srcset candidate.
        const imgUrl = (img: HTMLImageElement | null): string | null => {
          if (!img) return null;
          const srcset = img.getAttribute("srcset") ?? img.getAttribute("data-srcset") ?? "";
          const candidates = [
            img.currentSrc,
            img.src,
            img.getAttribute("data-src"),
            srcset.split(",")[0]?.trim().split(/\s+/)[0],
          ];
          for (const c of candidates) if (c && /^https?:/.test(c)) return c;
          return null;
        };
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
          const url = imgUrl(img);
          const idMatch = url?.match(/\/dishes\/(\d+)\//);
          const takeawayDishId = idMatch ? idMatch[1] : null;
          if (name && price !== null) {
            result.push({ name, price, category, takeawayDishId, imageUrl: url });
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
            const url = imgUrl(img);
            const idMatch = url?.match(/\/dishes\/(\d+)\//);
            const takeawayDishId = idMatch ? idMatch[1] : null;
            result.push({ name, price, category, takeawayDishId, imageUrl: url });
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
            const url = imgUrl(img);
            const idMatch = url?.match(/\/dishes\/(\d+)\//);
            const takeawayDishId = idMatch ? idMatch[1] : null;
            if (name && price !== null) {
              result.push({ name, price, category: null, takeawayDishId, imageUrl: url });
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
      imageUrl: d.imageUrl ?? undefined,
    })) as Dish[];
  } finally {
    await page.close().catch(() => {});
  }
}
