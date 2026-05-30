/**
 * Cart-build on takeaway.com via puppeteer.connect to the user's running
 * Chrome (`--remote-debugging-port=9222`). We open a *background* tab there,
 * drive the add-to-cart clicks, and hand back the restaurant URL so Slack
 * can drop a "Review & pay" link — clicking that lands in the same Chrome
 * with the basket already filled.
 *
 * Why we connect instead of launching:
 *   1. Cloudflare Turnstile blocks bundled-Chromium Puppeteer; the user's
 *      real Chrome already holds a valid cf_clearance.
 *   2. The cart sits in the same Chrome session, so the Pay link finds it.
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { FoodyState } from "./state.ts";
import type { Restaurant } from "./takeaway.ts";

puppeteer.use(StealthPlugin());

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEBUG_DIR = join(__dirname, "..", "state", "debug-checkout");
const DEBUG_ENABLED = process.env.FOODY_DEBUG === "1";

async function dumpHeadlessSnapshot(page: any, tag: string): Promise<string | null> {
  if (!DEBUG_ENABLED) return null;
  try {
    if (!existsSync(DEBUG_DIR)) mkdirSync(DEBUG_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const base = join(DEBUG_DIR, `${stamp}-${tag}`);
    const url = page.url();
    const title = await page.title().catch(() => "(no title)");
    const html = await page.content().catch(() => "");
    // Inventory clues — what does the page look like?
    const probe = await page
      .evaluate(() => {
        const dialog = !!document.querySelector('[role="dialog"]');
        const itemNames = document.querySelectorAll('[data-qa="item-name"]').length;
        const popularItems = document.querySelectorAll('[class*="popular-item-style_name"]').length;
        const cookieBanner = !!document.querySelector('button[id*="cookie"], [class*="CookieBanner"], [id*="onetrust"]');
        const cfChallenge = /cf-challenge|just a moment|cloudflare/i.test(document.body?.innerText ?? "");
        const loginCta = /sign in|inloggen|aanmelden/i.test(document.body?.innerText ?? "");
        const addressGate = /enter (your |a )?(address|postcode)|adres invoeren|set your address/i.test(document.body?.innerText ?? "");
        const bodyTextSample = (document.body?.innerText ?? "").slice(0, 600);
        return { dialog, itemNames, popularItems, cookieBanner, cfChallenge, loginCta, addressGate, bodyTextSample };
      })
      .catch(() => null);
    writeFileSync(`${base}.html`, html);
    writeFileSync(
      `${base}.json`,
      JSON.stringify({ tag, url, title, probe }, null, 2),
    );
    await page.screenshot({ path: `${base}.png`, fullPage: false }).catch(() => {});
    return base;
  } catch {
    return null;
  }
}

export type CartBuildResult = {
  ok: boolean;
  message: string;
  added: string[];
  failed: string[];
  url?: string;
  /** True when the failure is "Chrome not running on the debug port" — Slack uses this to nudge the user to relaunch Chrome. */
  needsLink?: boolean;
};

export type CartBuildProgress =
  | { stage: "connecting" }
  | { stage: "navigating" }
  | { stage: "adding"; current: number; total: number; itemName: string }
  | { stage: "done" }
  | { stage: "failed"; reason?: string };

export type CartBuildOptions = {
  /** Notified as the build moves through stages. Used to render a live progress card in Slack. */
  onProgress?: (event: CartBuildProgress) => void | Promise<void>;
};

const DEBUG_PORT = Number(process.env.FOODY_CHROME_DEBUG_PORT ?? "9222");
const DEBUG_HOST = process.env.FOODY_CHROME_DEBUG_HOST ?? "localhost";

/**
 * We attach to the user's already-running Chrome via the DevTools Protocol.
 * Two reasons we can't just launch our own headless / hidden Chrome:
 *
 *   1. takeaway.com is fronted by Cloudflare Turnstile, which fingerprints
 *      bundled-Chromium Puppeteer and blocks the menu page entirely. The
 *      user's real Chrome already has a valid cf_clearance for their IP +
 *      fingerprint, so it sails through.
 *   2. Even if we passed Cloudflare in a separate Chrome instance, the cart
 *      we built there wouldn't be visible in the user's normal browser —
 *      takeaway's cart state isn't fully account-keyed; it lives partly in
 *      browser storage / session cookies. The Slack "Pay" link opens in the
 *      user's default Chrome, so the cart-build has to happen there too.
 *
 * Trade-off: the user must launch Chrome with --remote-debugging-port=9222.
 * We never bring the cart-build tab to the front, so they never see a popup;
 * the tab sits silently in the background until they click Pay in Slack,
 * which opens the restaurant URL in the same Chrome and the basket is there.
 */
/**
 * Open a new tab WITHOUT focusing it. `browser.newPage()` uses
 * `Target.createTarget` and Chrome auto-focuses the new target unless we pass
 * `background: true`, which puppeteer's high-level API doesn't expose. We go
 * straight to CDP, then resolve the corresponding Puppeteer Page handle.
 */
async function openBackgroundPage(browser: any): Promise<any> {
  const session = await browser.target().createCDPSession();
  const created = (await session.send("Target.createTarget", {
    url: "about:blank",
    background: true,
  })) as { targetId: string };
  await session.detach().catch(() => {});
  const target = await browser.waitForTarget(
    (t: any) => (t._targetId ?? t.targetId?.()) === created.targetId,
    { timeout: 10_000 },
  );
  const page = await target.page();
  if (!page) throw new Error("Background tab created but no Page handle available.");
  return page;
}

async function connectToUserChrome() {
  try {
    const browser = await puppeteer.connect({
      browserURL: `http://${DEBUG_HOST}:${DEBUG_PORT}`,
      defaultViewport: null,
    });
    const page = await openBackgroundPage(browser);
    return { browser, page, missing: false as const };
  } catch (err: any) {
    return { browser: null as any, page: undefined, missing: true as const, error: err };
  }
}

async function dismissCookies(page: any): Promise<void> {
  await new Promise((r) => setTimeout(r, 700));
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button")) as HTMLButtonElement[];
    const accept = btns.find((b) => /accept all|alles accepter|alle accepteren/i.test(b.textContent ?? ""));
    accept?.click();
  });
  await new Promise((r) => setTimeout(r, 700));
}

async function ensureAddressSet(page: any, address: string): Promise<void> {
  // Probe the homepage's address input. If we're already in a session with a
  // saved address, the autocomplete-flow is a no-op; otherwise we drive it.
  await page.goto("https://www.takeaway.com/be-en", { waitUntil: "networkidle2", timeout: 60_000 });
  await dismissCookies(page);
  const inputHandle = await page.$('input[name="searchText"]').catch(() => null);
  if (!inputHandle) return; // No search input visible — already past the gate.
  await inputHandle.click({ clickCount: 3 });
  await page.keyboard.press("Backspace");
  await page.type('input[name="searchText"]', address, { delay: 60 });
  try {
    await page.waitForSelector('[role="option"]', { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 400));
    await page.evaluate(() => (document.querySelector('[role="option"]') as HTMLElement)?.click());
    await new Promise((r) => setTimeout(r, 3500));
  } catch {
    // Autocomplete didn't appear (probably already-set address) — fine.
  }
}

/**
 * Locate the dish row on a takeaway.com menu page and add it once.
 *
 * Takeaway has two different add-flows depending on where the dish lives:
 *   - "Popular items" grid: card opens a modal; the modal has the add button.
 *   - Regular menu list: each row has an inline "+" / stepper button; no modal.
 *
 * We find the row by takeawayDishId (matched against the dish image URL) when
 * we have one, falling back to an exact text match on the dish name (Unicode-
 * normalized so "ü" matches "ü"). Once we have the row, we look for an
 * add-style button *inside that row* — never page-wide, which was the old bug
 * (any matching button anywhere on the page would get clicked, often the wrong
 * dish). If the row has no inline add button we treat it as a popular-item
 * card: click the row, wait for a modal, then click the add button scoped to
 * the modal.
 */
async function addOneDish(
  page: any,
  takeawayDishName: string,
  takeawayDishId: string | null,
): Promise<boolean> {
  const result: { kind: "inline" | "row-clicked" | "not-found" } = await page.evaluate(
    ({ name, id }: { name: string; id: string | null }) => {
      // esbuild (via tsx) wraps every named arrow with __name(fn, "..."). That
      // helper only exists in Node — in the browser context it'd ReferenceError.
      // Define a no-op so any leaked __name calls are harmless.
      // @ts-ignore
      if (typeof (globalThis as any).__name !== "function") (globalThis as any).__name = (fn: any) => fn;

      function nfc(s: string): string {
        return s.normalize("NFC").trim().toLowerCase();
      }
      const want = nfc(name);

      // ---- locate the row ----------------------------------------------------
      let row: HTMLElement | null = null;

      // Strategy A: takeaway dish id → image URL pattern /dishes/{id}/ (popular grid).
      if (id) {
        const img =
          (document.querySelector(`img[src*="/dishes/${id}/"]`) as HTMLImageElement | null) ??
          (document.querySelector(`img[srcset*="/dishes/${id}/"]`) as HTMLImageElement | null);
        if (img) {
          // Walk up to the FIRST ancestor that contains a real click target AND
          // mentions the dish name. Prefer click-bearing rows over the inert
          // data-qa="media" wrapper (which has no React click handler).
          let walk: HTMLElement | null = img.parentElement;
          for (let i = 0; i < 12 && walk; i++) {
            const txt = nfc(walk.textContent ?? "");
            const hasClick = walk.querySelector('[data-qa="item"], button, [role="button"]');
            if (txt.includes(want) && hasClick) {
              row = walk;
              break;
            }
            walk = walk.parentElement;
          }
        }
      }

      // Strategy B: takeaway's stable [data-qa="item-name"] hook (regular menu).
      if (!row) {
        const nameNodes = Array.from(
          document.querySelectorAll('[data-qa="item-name"]'),
        ) as HTMLElement[];
        const exact = nameNodes.find((el) => nfc(el.textContent ?? "") === want);
        if (exact) {
          let walk: HTMLElement | null = exact;
          for (let i = 0; i < 10 && walk; i++) {
            // Row qualifies if it contains both the name and the click target.
            const hasClick = walk.querySelector('[data-qa="item"], button, [role="button"]');
            if (hasClick) {
              row = walk;
              break;
            }
            walk = walk.parentElement;
          }
        }
      }

      // Strategy C: exact-text match on the dish name across common elements
      // (covers popular grid items, which use [class*="popular-item-style_name"]
      // rather than [data-qa="item-name"]).
      if (!row) {
        const els = Array.from(
          document.querySelectorAll("h1,h2,h3,h4,h5,h6,strong,span,a,p,div"),
        ) as HTMLElement[];
        let best: HTMLElement | null = null;
        for (const el of els) {
          if (nfc(el.textContent ?? "") === want) {
            if (!best || (el.textContent?.length ?? 0) <= (best.textContent?.length ?? 0)) {
              best = el;
            }
          }
        }
        if (best) {
          // Walk up to the SMALLEST ancestor that contains a click target.
          // Popular items nest a data-qa="media" wrapper above the name, but
          // that wrapper has no React onClick — the real click handler lives
          // one level higher on the row that also contains [data-qa="item"].
          let walk: HTMLElement | null = best;
          for (let i = 0; i < 12 && walk; i++) {
            const hasClick = walk.querySelector('[data-qa="item"], button, [role="button"]');
            if (hasClick) {
              row = walk;
              break;
            }
            walk = walk.parentElement;
          }
          // Last-resort fallback: a media/article wrapper (older popular layouts
          // where the whole card responds to a synthetic click on the wrapper).
          if (!row) row = best.closest('[data-qa="media"], article, li, section') as HTMLElement | null;
        }
      }

      if (!row) return { kind: "not-found" as const };

      // ---- try inline add inside the row ------------------------------------
      const btns = Array.from(
        row.querySelectorAll('button, [role="button"]'),
      ) as HTMLElement[];
      function isAddBtn(b: HTMLElement): boolean {
        const t = nfc(b.textContent ?? "");
        const aria = nfc(b.getAttribute("aria-label") ?? "");
        const dataQa = nfc(b.getAttribute("data-qa") ?? "");
        if (t === "+" || /^\+\s*$/.test(t)) return true;
        if (/(^|\s)(add to (cart|basket|order)|toevoegen|in winkelmandje|to basket|^add\b)/.test(t)) return true;
        if (/(add to (cart|basket|order)|increase|increment|plus|toevoegen)/.test(aria)) return true;
        if (/add|increment|plus/.test(dataQa)) return true;
        return false;
      }
      const addBtn = btns.find(isAddBtn);
      if (addBtn) {
        addBtn.click();
        return { kind: "inline" as const };
      }

      // ---- otherwise click the row's modal-trigger and let the dialog open --
      // Prefer takeaway's [data-qa="item"] over the bare row click — the row div
      // itself often has no React onClick handler; the inner span does.
      const trigger =
        (row.querySelector('[data-qa="item"]') as HTMLElement | null) ??
        (row.querySelector('[role="button"]') as HTMLElement | null) ??
        row;
      trigger.click();
      return { kind: "row-clicked" as const };
    },
    { name: takeawayDishName, id: takeawayDishId },
  );

  if (result.kind === "not-found") return false;

  if (result.kind === "inline") {
    // Inline-stepper add: takeaway typically updates the cart immediately.
    await new Promise((r) => setTimeout(r, 700));
    return true;
  }

  // Modal-style add: takeaway renders the Add CTA as a <pie-button> custom
  // element with data-qa="item-choices-action-submit". Some dishes (popular
  // items with size/sauce choices) require a single-select radio group to be
  // chosen before submit enables — in that case the data-qa becomes
  // "item-choices-action-submit-disabled". We auto-select the first option in
  // any unchecked required group, wait for submit to enable, then click it.
  // Retries up to ~4s.
  let added = false;
  for (let attempt = 0; attempt < 8 && !added; attempt++) {
    await new Promise((r) => setTimeout(r, 500));
    added = await page.evaluate(() => {
      // @ts-ignore — defuse esbuild's __name helper in the browser context.
      if (typeof (globalThis as any).__name !== "function") (globalThis as any).__name = (fn: any) => fn;
      function nfc(s: string): string {
        return s.normalize("NFC").trim().toLowerCase();
      }
      // Prefer a visible dialog/modal as the search scope.
      const dialog =
        (document.querySelector('[role="dialog"][data-qa="modal"]') as HTMLElement | null) ??
        (document.querySelector('[role="dialog"]') as HTMLElement | null) ??
        (document.querySelector('[class*="modal"], [class*="Modal"], [data-qa*="modal"]') as HTMLElement | null);
      if (!dialog) return false;

      // Auto-select required single-choice radio groups (size, sauce, etc.). We
      // leave multi-choice groups (toppings) alone — those are optional extras.
      const radioGroups = Array.from(
        dialog.querySelectorAll('[data-qa="item-choices-options-single-radio"]'),
      ) as HTMLElement[];
      for (const group of radioGroups) {
        const radios = Array.from(
          group.querySelectorAll('[role="radio"], [data-qa^="item-choices-options-single-element-"]'),
        ) as HTMLElement[];
        if (radios.length === 0) continue;
        const alreadyChecked = radios.some((r) => r.getAttribute("aria-checked") === "true");
        if (!alreadyChecked) {
          radios[0].click();
        }
      }

      // Stable hook — submit becomes enabled once required choices are made.
      const submit =
        (dialog.querySelector('[data-qa="item-choices-action-submit"]') as HTMLElement | null) ??
        (dialog.querySelector('pie-button[data-qa*="submit"]:not([data-qa$="-disabled"])') as HTMLElement | null);
      if (submit) {
        submit.click();
        return true;
      }

      // Fallback (older layouts): any clickable in the modal footer that looks
      // add-like. We exclude the disabled variant explicitly.
      const footer = dialog.querySelector('[data-qa="modal-footer"]') as HTMLElement | null;
      const candidates = Array.from(
        (footer ?? dialog).querySelectorAll('button, [role="button"], pie-button, a'),
      ) as HTMLElement[];
      const addCta = candidates.find((el) => {
        const dq = nfc(el.getAttribute("data-qa") ?? "");
        if (dq.endsWith("-disabled")) return false;
        const t = nfc(el.textContent ?? "");
        const aria = nfc(el.getAttribute("aria-label") ?? "");
        if (/^add\b|toevoeg|in winkelmand|to basket|to (cart|order)/.test(t)) return true;
        if (/adds .* to shopping basket|voeg .* toe|to (basket|cart|order)/.test(aria)) return true;
        if (/(submit|add\b|cta)(?!.*disabled)/.test(dq)) return true;
        return false;
      });
      if (addCta) {
        addCta.click();
        return true;
      }
      return false;
    });
  }
  // After the click the modal closes and the cart updates; give the page a beat.
  await new Promise((r) => setTimeout(r, 1500));
  return added;
}

/**
 * Build the cart on takeaway.com for a real restaurant. Repeats per quantity.
 */
export async function buildCartOnTakeaway(
  state: FoodyState,
  restaurant: Restaurant,
  opts: CartBuildOptions = {},
): Promise<CartBuildResult> {
  const notify = async (event: CartBuildProgress) => {
    try {
      await opts.onProgress?.(event);
    } catch {
      // Progress UI failures must never break the build.
    }
  };
  if (!restaurant.takeawayUrl) {
    return { ok: false, message: "Not a real restaurant — nothing to build.", added: [], failed: [] };
  }
  if (!state.address) {
    return { ok: false, message: "No address set for this session.", added: [], failed: [] };
  }

  await notify({ stage: "connecting" });
  const launched = await connectToUserChrome();

  if (launched.missing) {
    return {
      ok: false,
      message:
        `Couldn't reach your Chrome on ${DEBUG_HOST}:${DEBUG_PORT}. Quit Chrome and relaunch it once with the debug port:\n` +
        "`open -a \"Google Chrome\" --args --remote-debugging-port=9222`\n" +
        "Make sure you're signed into takeaway.com in that Chrome — then try again. The cart will be built in a *background tab* (no popup), and Pay will open here.",
      added: [],
      failed: state.cart.map((l) => l.dishId),
      needsLink: true,
    };
  }
  const { browser, page } = launched as { browser: any; page: any };

  try {
    await notify({ stage: "navigating" });
    await ensureAddressSet(page, state.address);

    await page.goto(restaurant.takeawayUrl, { waitUntil: "networkidle2", timeout: 60_000 });
    await dismissCookies(page);
    await new Promise((r) => setTimeout(r, 2000));

    await dumpHeadlessSnapshot(page, "menu-loaded");

    const added: string[] = [];
    const failed: string[] = [];

    const totalLines = state.cart.length;
    for (let idx = 0; idx < state.cart.length; idx++) {
      const line = state.cart[idx];
      const menuItem = state.menu.find((m) => m.dishId === line.dishId);
      const dishName =
        (menuItem as any)?.takeawayDishName ?? menuItem?.name ?? null;
      if (!dishName) {
        failed.push(line.dishId);
        continue;
      }
      await notify({
        stage: "adding",
        current: idx + 1,
        total: totalLines,
        itemName: menuItem?.name ?? dishName,
      });
      const idTail = line.dishId.match(/-([^-]+)$/)?.[1] ?? null;
      const takeawayDishId =
        (menuItem as any)?.takeawayDishId ?? (idTail && /^\d+$/.test(idTail) ? idTail : null);
      let okQty = 0;
      for (let q = 0; q < line.qty; q++) {
        const ok = await addOneDish(page, dishName, takeawayDishId);
        if (ok) okQty++;
        else break;
      }
      if (okQty === line.qty) added.push(`${line.qty}× ${dishName}`);
      else failed.push(`${line.qty}× ${dishName} (got ${okQty})`);
    }

    if (failed.length > 0) {
      const base = await dumpHeadlessSnapshot(page, "after-failures");
      if (base) console.log(`[checkout] failure snapshot written to ${base}.{png,html,json}`);
    }

    const url = page.url();
    if (failed.length === 0) {
      await notify({ stage: "done" });
    } else {
      await notify({ stage: "failed", reason: `Built ${added.length} of ${state.cart.length}` });
    }
    return {
      ok: failed.length === 0,
      message:
        failed.length === 0
          ? "Cart built on takeaway.com — tap below to review & pay."
          : `Built ${added.length} of ${state.cart.length} lines. Tap below to review what's there.`,
      added,
      failed,
      url,
    };
  } finally {
    // We attached to the user's Chrome — disconnect (don't close, that'd kill their browser).
    browser.disconnect();
  }
}
