import { describe, it, expect } from "vitest";
import {
  emojiForSlackName,
  slackNameForUnicode,
  assignUniqueEmojis,
  FALLBACK_EMOJIS,
} from "../src/emojis";

describe("shortcode <-> unicode lookup", () => {
  it("maps a known shortcode to its pair", () => {
    expect(emojiForSlackName("pizza")).toEqual({ unicode: "🍕", slack: "pizza" });
  });
  it("returns null for an unknown shortcode", () => {
    expect(emojiForSlackName("not_a_real_emoji")).toBeNull();
  });
  it("round-trips unicode back to the shortcode", () => {
    expect(slackNameForUnicode("🍕")).toBe("pizza");
    expect(slackNameForUnicode("🦄")).toBeNull();
  });
});

describe("assignUniqueEmojis", () => {
  const slacks = (pairs: { slack: string }[]) => pairs.map((p) => p.slack);

  it("gives every dish a distinct emoji when prefs don't collide", () => {
    const out = assignUniqueEmojis([
      { thematicPrefs: ["tomato", "pizza", "pie"] },
      { thematicPrefs: ["onion", "pizza", "pie"] },
      { thematicPrefs: ["mushroom", "pizza", "pie"] },
      { thematicPrefs: ["hot_pepper", "pizza", "pie"] },
      { thematicPrefs: ["pineapple", "pizza", "pie"] },
    ]);
    expect(slacks(out)).toEqual(["tomato", "onion", "mushroom", "hot_pepper", "pineapple"]);
    expect(new Set(slacks(out)).size).toBe(out.length); // all unique
  });

  it("never returns a duplicate, even when every pref collides", () => {
    // All five dishes only want "pizza" — only one can have it; the rest must
    // fall back to numbered badges, and the whole list stays unique.
    const out = assignUniqueEmojis(Array.from({ length: 5 }, () => ({ thematicPrefs: ["pizza"] })));
    expect(out).toHaveLength(5);
    expect(new Set(slacks(out)).size).toBe(5);
    expect(out[0]).toEqual({ unicode: "🍕", slack: "pizza" });
    // remaining four are numbered fallbacks
    expect(slacks(out).slice(1)).toEqual(FALLBACK_EMOJIS.slice(0, 4).map((f) => f.slack));
  });

  it("always prefers an uploaded custom emoji", () => {
    const out = assignUniqueEmojis([
      { customSlack: "foody_margherita", thematicPrefs: ["pizza"] },
      { thematicPrefs: ["pizza"] },
    ]);
    expect(out[0]).toEqual({ unicode: ":foody_margherita:", slack: "foody_margherita" });
    expect(out[1]).toEqual({ unicode: "🍕", slack: "pizza" }); // pizza still free for dish 2
  });

  it("is deterministic for the same input", () => {
    const input = [{ thematicPrefs: ["sushi", "fish"] }, { thematicPrefs: ["sushi", "fish"] }];
    expect(assignUniqueEmojis(input)).toEqual(assignUniqueEmojis(input));
  });
});
