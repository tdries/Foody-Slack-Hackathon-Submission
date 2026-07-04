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
  "/foody",
  "foody start",
];

// Short Dutch words need word boundaries — plain substring matching made
// "star trek" and "betrekken" start a food order.
const TRIGGER_RE = /\bhonger\b|\b(?:ik heb|heb je|hebben|krijg) trek\b|\btrek in\b/;

export function isFoodyTrigger(text: string | undefined): boolean {
  if (!text) return false;
  const t = text.toLowerCase().trim();
  return TRIGGERS.some((tr) => t.includes(tr)) || TRIGGER_RE.test(t);
}

// Anchored to the whole message: a substring match placed real orders when
// someone asked "good to go?" or mentioned "the order" in the thread.
const CONFIRM_RE = /^\s*(?:please\s+)?(?:order(?:\s+now)?|place(?:\s+the)?\s+order|checkout|bestel(?:len)?|confirm|go|yes|ja)\s*[.!?…]*\s*$/i;

export function isOrderConfirm(text: string | undefined): boolean {
  if (!text) return false;
  return CONFIRM_RE.test(text);
}

export function isResetCommand(text: string | undefined): boolean {
  if (!text) return false;
  const t = text.toLowerCase().trim();
  return /\b(reset(\s+foody)?|start over|cancel order|vergeet alles)\b/.test(t);
}

/**
 * Strip Slack markdown wrappers and courtesy words that leak into captures —
 * users paste the italic hint verbatim ("change address to _Meir 1_") or say
 * "my address is …", which once stored "to Dorp 48, 2230 Herselt_" as a
 * literal address.
 */
export function sanitizeAddress(raw: string): string {
  return raw
    .trim()
    .replace(/^[_*~`>]+|[_*~`]+$/g, "")
    .trim()
    .replace(/^(?:to|is|naar)\s+/i, "")
    .trim();
}

export function extractChangeAddress(text: string | undefined): string | null {
  if (!text) return null;
  const m = text.match(/(?:change\s+(?:my\s+)?address\s+(?:to\s+)?|deliver\s+to\s+|address[:=]?\s+)(.+)/i);
  if (!m) return null;
  const addr = sanitizeAddress(m[1]);
  return addr.length > 0 ? addr : null;
}
