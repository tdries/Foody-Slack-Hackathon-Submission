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
import { spawn } from "node:child_process";
import { homedir } from "node:os";
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
  | { stage: "connecting"; note?: string }
  | { stage: "navigating"; note?: string }
  | { stage: "adding"; current: number; total: number; itemName: string }
  | { stage: "done" }
  | { stage: "failed"; reason?: string };

export type CartBuildOptions = {
  /** Notified as the build moves through stages. Used to render a live progress card in Slack. */
  onProgress?: (event: CartBuildProgress) => void | Promise<void>;
};

const DEBUG_PORT = Number(process.env.FOODY_CHROME_DEBUG_PORT ?? "9222");
const DEBUG_HOST = process.env.FOODY_CHROME_DEBUG_HOST ?? "localhost";

// takeaway.com market to drive the basket on. Matches scrape-live's LOCALE so
// checkout opens the same country's site the menu was discovered on. Restaurant
// URLs already carry their locale; this is just for the address-set homepage.
const TAKEAWAY_LOCALE = (process.env.FOODY_TAKEAWAY_LOCALE ?? "be-en").trim();
const TAKEAWAY_HOME = `https://www.takeaway.com/${TAKEAWAY_LOCALE}`;

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

/**
 * Persistent profile dir for the Foody-launched Chrome. We deliberately do NOT
 * reuse the user's default profile: attaching a debug port to an
 * already-running default Chrome silently fails (the new flag-bearing process
 * just hands off to the existing one). A dedicated dir always spawns a fresh
 * process with the port live. It persists (not /tmp), so a takeaway.com login
 * done once sticks across launches.
 */
const CHROME_PROFILE_DIR =
  process.env.FOODY_CHROME_PROFILE_DIR ?? join(homedir(), ".foody-chrome");

function chromeBinary(): string {
  if (process.env.FOODY_CHROME_BIN) return process.env.FOODY_CHROME_BIN;
  switch (process.platform) {
    case "darwin":
      return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    case "win32":
      return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
    default:
      return "google-chrome";
  }
}

/** Quick liveness probe of the DevTools endpoint — no Puppeteer attach. */
export async function isChromeDebugUp(): Promise<boolean> {
  try {
    const res = await fetch(`http://${DEBUG_HOST}:${DEBUG_PORT}/json/version`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export type ChromeLaunchResult = {
  ok: boolean;
  alreadyRunning: boolean;
  message: string;
};

/**
 * Spawn a detached Chrome with the remote-debugging port and wait for the
 * DevTools endpoint to answer. Lets Slack offer a one-click "launch the basket
 * builder" button instead of asking the user to run a terminal command.
 */
export async function launchUserChrome(
  opts: { timeoutMs?: number } = {},
): Promise<ChromeLaunchResult> {
  if (await isChromeDebugUp()) {
    return { ok: true, alreadyRunning: true, message: "Chrome debug port already up." };
  }

  const bin = chromeBinary();
  try {
    const child = spawn(
      bin,
      [
        `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=${CHROME_PROFILE_DIR}`,
        // Run the Foody-controlled Chrome clean: browser extensions (e.g. VeePN)
        // inject overlays/placeholder text onto the basket page, which both
        // confuses the user and can break the add-to-cart DOM matching.
        "--disable-extensions",
        "--no-first-run",
        "--no-default-browser-check",
        "about:blank",
      ],
      { detached: true, stdio: "ignore" },
    );
    child.on("error", () => {});
    child.unref();
  } catch (err: any) {
    return {
      ok: false,
      alreadyRunning: false,
      message: `Couldn't launch Chrome at "${bin}": ${err?.message ?? err}. Set FOODY_CHROME_BIN if it lives elsewhere.`,
    };
  }

  const timeoutMs = opts.timeoutMs ?? 25_000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isChromeDebugUp()) {
      return { ok: true, alreadyRunning: false, message: "Chrome launched with the debug port." };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return {
    ok: false,
    alreadyRunning: false,
    message: "Launched Chrome, but the debug port never came up in time.",
  };
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

async function ensureAddressSet(
  page: any,
  address: string,
  onStep?: (note: string) => void | Promise<void>,
): Promise<void> {
  // Probe the homepage's address input. If we're already in a session with a
  // saved address, the autocomplete-flow is a no-op; otherwise we drive it.
  await onStep?.("Opening takeaway.com");
  await page.goto(TAKEAWAY_HOME, { waitUntil: "networkidle2", timeout: 60_000 });
  await onStep?.("Clearing the cookie banner");
  await dismissCookies(page);
  const inputHandle = await page.$('input[name="searchText"]').catch(() => null);
  if (!inputHandle) return; // No search input visible — already past the gate.
  await onStep?.(`Setting delivery to ${address}`);
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
  // takeaway.com renders the menu as a VIRTUALIZED list — only the dishes near
  // the viewport exist in the DOM at any moment (we saw ~9 item rows for a menu
  // of dozens). Scroll until this dish's row is rendered before matching it,
  // otherwise the search runs against a DOM that simply doesn't contain it yet.
  await scrollMenuToDish(page, takeawayDishName);

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
 * Scroll the (virtualized) menu until the row whose exact name matches
 * `dishName` is rendered, then centre it. Returns true if it became visible.
 * Best-effort and defensive — scrolling the window materializes lazily-rendered
 * rows on takeaway.com so the matcher can find dishes below the initial fold.
 */
async function scrollMenuToDish(page: any, dishName: string): Promise<boolean> {
  try {
    return await page.evaluate(async (rawName: string) => {
      // @ts-ignore — defuse esbuild's __name helper in the browser context.
      if (typeof (globalThis as any).__name !== "function") (globalThis as any).__name = (fn: any) => fn;
      const nfc = (s: string) => s.normalize("NFC").trim().toLowerCase();
      const want = nfc(rawName);
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      // Exact-text leaf match (mirrors the matcher's strategy C) so the long
      // category "preview" strings (which merely list dish names) never count.
      const findExact = (): HTMLElement | null =>
        (Array.from(
          document.querySelectorAll("h1,h2,h3,h4,h5,h6,strong,span,a,p,div"),
        ) as HTMLElement[]).find((el) => nfc(el.textContent ?? "") === want) ?? null;

      let hit = findExact();
      if (hit) { hit.scrollIntoView({ block: "center" }); await sleep(250); return true; }

      let lastY = -1;
      for (let i = 0; i < 45; i++) {
        window.scrollBy(0, Math.round(window.innerHeight * 0.8));
        await sleep(220);
        hit = findExact();
        if (hit) { hit.scrollIntoView({ block: "center" }); await sleep(250); return true; }
        if (window.scrollY === lastY) break; // reached the bottom — not present
        lastY = window.scrollY;
      }
      return findExact() != null;
    }, dishName);
  } catch {
    return false;
  }
}

/**
 * Empty whatever is currently in the takeaway.com basket on `page`.
 *
 * Run before building a fresh order so leftovers from a previous Foody session
 * never mix into (or get confused with) the new one. Best-effort and fully
 * defensive: it tries a single "empty/clear basket" control, handles the
 * "start a new order?" confirm that appears when the basket holds items from a
 * different restaurant, and otherwise removes basket lines one by one. Any
 * failure is swallowed — a stale basket is better than a broken build.
 *
 * Returns the number of remove actions performed (0 = basket was already empty).
 */
async function clearBasket(page: any): Promise<number> {
  let actions = 0;
  for (let pass = 0; pass < 30; pass++) {
    const did: string | null = await page
      .evaluate(() => {
        const norm = (s: string | null) => (s ?? "").toLowerCase().trim();
        const all = Array.from(
          document.querySelectorAll('button, [role="button"], a'),
        ) as HTMLElement[];

        // 1) A single "empty/clear basket" or "start new order" control.
        const clearAll = all.find((b) => {
          const t = norm(b.textContent) + " " + norm(b.getAttribute("aria-label"));
          return (
            /(empty|clear)\s+(your\s+)?(basket|cart|order)/.test(t) ||
            /leeg(maken)?\s*(je\s*)?(winkelmand|mand|basket)/.test(t) ||
            /maak\s+(de\s+)?(winkelmand|mand)\s+leeg/.test(t) ||
            /start\s+(a\s+)?new\s+(order|basket)/.test(t) ||
            /nieuwe?\s+(bestelling|mand)/.test(t)
          );
        });
        if (clearAll) {
          (clearAll as HTMLButtonElement).click();
          return "clear-all";
        }

        // 2) Otherwise decrement/remove a single basket line. Scope to the
        // basket/side-cart so we never touch menu "+/-" steppers.
        const scope =
          (document.querySelector(
            '[data-qa*="basket" i], [data-qa*="cart" i], [class*="basket" i], [class*="sidecart" i], [class*="side-cart" i], aside',
          ) as HTMLElement | null) ?? document.body;
        const ctrls = Array.from(
          scope.querySelectorAll('button, [role="button"]'),
        ) as HTMLElement[];
        const rm = ctrls.find((b) => {
          const t = norm(b.textContent);
          const a =
            norm(b.getAttribute("aria-label")) + " " + norm(b.getAttribute("data-qa"));
          return (
            /^(-|−|–|×|x|remove|delete|verwijder)$/.test(t) ||
            /\b(remove|delete|decrement|verwijder|verlaag|minder)\b/.test(a)
          );
        });
        if (rm) {
          (rm as HTMLButtonElement).click();
          return "remove-one";
        }
        return null;
      })
      .catch(() => null);

    if (!did) break;
    actions++;
    await new Promise((r) => setTimeout(r, 450));
  }
  return actions;
}

/**
 * Best-effort: empty the user's takeaway.com basket WITHOUT a restaurant
 * context — used when a fresh Foody session starts so stale items don't linger.
 * No-op (returns null) unless the debug Chrome is already up, so it never
 * launches a browser or blocks the Slack trigger. Runs in a background tab.
 */
export async function clearSiteBasket(): Promise<number | null> {
  if (!(await isChromeDebugUp())) return null;
  const launched = await connectToUserChrome();
  if (launched.missing) return null;
  const { browser, page } = launched as { browser: any; page: any };
  try {
    await page.goto(TAKEAWAY_HOME, { waitUntil: "networkidle2", timeout: 45_000 });
    await dismissCookies(page);
    await new Promise((r) => setTimeout(r, 1200));
    return await clearBasket(page);
  } catch {
    return null;
  } finally {
    try { await page.close(); } catch {}
    try { browser.disconnect(); } catch {}
  }
}

/**
 * Best-effort: raise the macOS Chrome window whose active tab is on
 * takeaway.com (the basket window) to the foreground. `page.bringToFront()`
 * only re-orders tabs inside the browser process; it does not pull the OS
 * window forward when another app (Slack) is active. AppleScript does.
 */
function raiseTakeawayWindow(): void {
  if (process.platform !== "darwin") return;
  const osa = [
    'tell application "Google Chrome"',
    "  activate",
    "  repeat with w in windows",
    "    try",
    '      if (URL of active tab of w) contains "takeaway" then',
    "        set index of w to 1",
    "        exit repeat",
    "      end if",
    "    end try",
    "  end repeat",
    "end tell",
  ].join("\n");
  try {
    spawn("osascript", ["-e", osa], { stdio: "ignore", detached: true }).unref();
  } catch {
    /* best-effort only */
  }
}

/**
 * Bring the Foody Chrome tab that holds the freshly-built basket to the front,
 * so the user reviews & pays in the SAME profile the basket was built in.
 *
 * This is why "Review & pay" is a Slack action, not a url button: a url button
 * opens Slack's *default* browser, which is a different Chrome profile with its
 * own (empty) takeaway.com session. The basket lives only in `~/.foody-chrome`.
 */
export async function surfaceBasketForPay(
  payUrl?: string,
): Promise<{ ok: boolean; message: string }> {
  if (!(await isChromeDebugUp())) {
    return {
      ok: false,
      message:
        "The Foody Chrome window isn't running anymore, so the basket is gone. Re-run the order to rebuild it.",
    };
  }
  try {
    const browser = await puppeteer.connect({
      browserURL: `http://${DEBUG_HOST}:${DEBUG_PORT}`,
      defaultViewport: null,
    });
    try {
      const pages = await browser.pages();
      let page =
        pages.find((p: any) => /takeaway\.com/.test(p.url())) ??
        (payUrl ? pages.find((p: any) => p.url() === payUrl) : undefined) ??
        null;
      if (!page) {
        page = await browser.newPage();
        if (payUrl)
          await page
            .goto(payUrl, { waitUntil: "domcontentloaded", timeout: 30_000 })
            .catch(() => {});
      }
      await page.bringToFront().catch(() => {});
      raiseTakeawayWindow();
      return {
        ok: true,
        message:
          "🪟 Brought the *Foody Chrome* window (the one with your items) to the front — review & pay there. If you don't see it, switch Chrome windows with ⌘\\` — your default browser has a separate, empty basket.",
      };
    } finally {
      browser.disconnect();
    }
  } catch {
    return {
      ok: false,
      message:
        "Couldn't reach the Foody Chrome window. Switch to the Chrome window showing the restaurant menu to review & pay.",
    };
  }
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

  await notify({ stage: "connecting", note: "Connecting to your Chrome" });
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
    await notify({ stage: "navigating", note: "Waking up the browser" });
    await ensureAddressSet(page, state.address, (note) =>
      notify({ stage: "navigating", note }),
    );

    await notify({ stage: "navigating", note: `Opening the ${restaurant.name} menu` });
    await page.goto(restaurant.takeawayUrl, { waitUntil: "networkidle2", timeout: 60_000 });
    await dismissCookies(page);
    await notify({ stage: "navigating", note: "Reading the menu" });
    await new Promise((r) => setTimeout(r, 2000));

    await dumpHeadlessSnapshot(page, "menu-loaded");

    // Start from an empty basket: clear any leftovers from a previous session
    // so the order we place is exactly this session's picks, nothing extra.
    await notify({ stage: "navigating", note: "Clearing any leftover basket" });
    const cleared = await clearBasket(page);
    if (cleared > 0) await notify({ stage: "navigating", note: `Removed ${cleared} leftover item(s)` });

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
      // Surface the basket tab so the user sees it in the Foody Chrome window
      // (not their default browser) the moment the build finishes.
      await page.bringToFront().catch(() => {});
      raiseTakeawayWindow();
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
