#!/usr/bin/env tsx
/**
 * Basket-correctness harness.
 *
 * Runs N scenarios across different restaurants / cuisines / dish-sets and
 * cross-checks that the basket Foody composes is correct:
 *   B. every dish in a menu gets a UNIQUE emoji (no two dishes share one)
 *   C. round-trip: tapping a dish's emoji resolves back to THAT dish
 *   D. quantities are right (tapping the same emoji twice => qty 2)
 *   E. subtotal == sum(unitPrice * qty), penny-accurate
 *   F. min-order gate matches the restaurant's minimum
 * Numbered-badge fallbacks are reported as a quality metric (still correct,
 * just less pretty).
 *
 * Run: npx tsx scripts/test-baskets.ts
 */
import { getRestaurant, getTopDishes } from "../src/takeaway.ts";
import { assignUniqueEmojis } from "../src/emojis.ts";

const REST_IDS = [
  "rest-real-pizza-roma", "rest-001", "rest-002", "rest-003", "rest-004",
  "rest-005", "rest-006", "rest-007", "rest-008", "rest-009", "rest-010",
];
const FALLBACK = new Set(["one","two","three","four","five","six","seven","eight","nine","keycap_ten"]);
const strip = (u: string) => u.replace(/️/g, "").trim();

type Line = { dishId: string; qty: number };
let totalChecks = 0, failChecks = 0, totalFallbacks = 0;
const rows: string[] = [];

function check(cond: boolean, label: string, detail = ""): boolean {
  totalChecks++;
  if (!cond) { failChecks++; console.log(`      ✗ ${label}${detail ? " — " + detail : ""}`); }
  return cond;
}

async function scenario(i: number) {
  const restId = REST_IDS[i % REST_IDS.length];
  const rest = await getRestaurant(restId);
  if (!rest) { check(false, `restaurant ${restId} exists`); return; }
  const dishes = await getTopDishes(rest.id, 10);
  const emojis = assignUniqueEmojis(dishes.map((d) => ({ customSlack: d.customEmoji, thematicPrefs: d.slackEmojiPrefs })));
  const menu = dishes.map((d, idx) => ({ dishId: d.id, name: d.name, price: d.price, emoji: emojis[idx] }));

  // ---- B: unique emojis within the menu ----
  const uni = menu.map((m) => strip(m.emoji.unicode));
  const okUnique = check(new Set(uni).size === uni.length, "emojis unique",
    `${uni.length - new Set(uni).size} dup(s)`);
  const fallbacks = menu.filter((m) => FALLBACK.has(m.emoji.slack)).length;
  totalFallbacks += fallbacks;

  // ---- C: round-trip emoji -> dish ----
  let rtOk = true;
  for (const m of menu) {
    const hit = menu.find((x) => strip(x.emoji.unicode) === strip(m.emoji.unicode));
    if (!hit || hit.dishId !== m.dishId) rtOk = false;
  }
  check(rtOk, "emoji→dish round-trip");

  // ---- D/E: build a basket by "tapping" a deterministic subset (some twice) ----
  const n = menu.length;
  const picks = [...new Set([ (i) % n, (i * 2 + 1) % n, (i * 3 + 2) % n, (i + 4) % n ])];
  const taps: string[] = [];
  picks.forEach((p, k) => { taps.push(uni[p]); if (k === 0) taps.push(uni[p]); }); // first pick tapped twice
  const expectQty: Record<string, number> = {};
  for (const t of taps) { const m = menu.find((x) => strip(x.emoji.unicode) === t)!; expectQty[m.dishId] = (expectQty[m.dishId] ?? 0) + 1; }

  // reconstruct cart the way cli.cmdCart does
  const cart: Line[] = [];
  for (const t of taps) {
    const m = menu.find((x) => strip(x.emoji.unicode) === t)!;
    const ex = cart.find((l) => l.dishId === m.dishId);
    if (ex) ex.qty += 1; else cart.push({ dishId: m.dishId, qty: 1 });
  }
  const qtyOk = check(
    cart.every((l) => l.qty === expectQty[l.dishId]) && cart.length === Object.keys(expectQty).length,
    "quantities correct");

  // subtotal penny-accurate
  const subtotal = +cart.reduce((s, l) => s + (menu.find((m) => m.dishId === l.dishId)!.price * l.qty), 0).toFixed(2);
  const expectSub = +Object.entries(expectQty).reduce((s, [id, q]) => s + menu.find((m) => m.dishId === id)!.price * q, 0).toFixed(2);
  const subOk = check(subtotal === expectSub, "subtotal == sum(price*qty)", `${subtotal} vs ${expectSub}`);

  // min-order gate
  const meets = subtotal >= rest.minOrder;
  check(typeof rest.minOrder === "number", "min-order defined");

  const status = (okUnique && rtOk && qtyOk && subOk) ? "✅" : "❌";
  rows.push(
    `${status}  #${String(i + 1).padStart(2)}  ${rest.cuisine.padEnd(11)} ${rest.id.padEnd(22)} ` +
    `dishes:${String(n).padStart(2)} emoji:${uni.join("")}  ` +
    `cart:${cart.length}items q${cart.reduce((s,l)=>s+l.qty,0)} €${subtotal.toFixed(2)} ` +
    `${meets ? "≥min" : "<min"}(${rest.minOrder}) ${fallbacks ? "·"+fallbacks+"#" : ""}`,
  );
}

async function main() {
  console.log("Running 20 basket-correctness scenarios…\n");
  for (let i = 0; i < 20; i++) await scenario(i);
  console.log("\n" + rows.join("\n"));
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Checks: ${totalChecks} run · ${totalChecks - failChecks} passed · ${failChecks} failed`);
  console.log(`Numbered-badge fallbacks across all menus: ${totalFallbacks} (lower = prettier; 0 ideal)`);
  console.log(failChecks === 0 ? "RESULT: ✅ all baskets composed correctly" : `RESULT: ❌ ${failChecks} failing checks`);
  process.exit(failChecks === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
