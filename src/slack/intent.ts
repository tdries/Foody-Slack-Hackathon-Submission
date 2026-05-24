/**
 * "Let's eat something" intent detection.
 *
 * Kept deliberately conservative: we'd rather miss an ambiguous "I'm hungry
 * for adventure" than hijack a thread. Add variants by listing whole
 * phrases — substring matching is intentional so contractions and casing
 * don't matter.
 */
const TRIGGERS: string[] = [
  "let's eat",
  "lets eat",
  "let's order food",
  "lets order food",
  "order food",
  "i'm hungry",
  "im hungry",
  "i am hungry",
  "lunch time",
  "lunchtime",
  "time to eat",
  "wat eten we",
  "honger",
  "trek",
  "/foody",
  "foody start",
];

export function isFoodyTrigger(text: string | undefined): boolean {
  if (!text) return false;
  const t = text.toLowerCase().trim();
  return TRIGGERS.some((tr) => t.includes(tr));
}

export function isOrderConfirm(text: string | undefined): boolean {
  if (!text) return false;
  const t = text.toLowerCase().trim();
  return /\b(order|place order|checkout|bestel|go|confirm|ja)\b/.test(t);
}

export function isResetCommand(text: string | undefined): boolean {
  if (!text) return false;
  const t = text.toLowerCase().trim();
  return /\b(reset(\s+foody)?|start over|cancel order|vergeet alles)\b/.test(t);
}

export function extractChangeAddress(text: string | undefined): string | null {
  if (!text) return null;
  const m = text.match(/(?:change\s+(?:my\s+)?address\s+(?:to\s+)?|deliver\s+to\s+|address[:=]?\s+)(.+)/i);
  return m ? m[1].trim() : null;
}
