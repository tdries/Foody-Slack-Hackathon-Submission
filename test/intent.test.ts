import { describe, it, expect } from "vitest";
import {
  isFoodyTrigger,
  isOrderConfirm,
  isResetCommand,
  extractChangeAddress,
} from "../src/slack/intent";

describe("isFoodyTrigger", () => {
  it("fires on the canonical phrases (case- and contraction-insensitive)", () => {
    for (const t of [
      "let's eat something",
      "LET'S EAT",
      "lets eat now",
      "order food please",
      "I'm hungry",
      "im hungry",
      "lunchtime!",
      "time to eat",
      "wat eten we",
      "honger",
      "/foody",
    ]) {
      expect(isFoodyTrigger(t)).toBe(true);
    }
  });

  it("does not hijack unrelated messages", () => {
    for (const t of [
      "hungry for adventure",
      "let's meet at 3",
      "the eatery downtown is nice",
      "",
      undefined,
    ]) {
      expect(isFoodyTrigger(t)).toBe(false);
    }
  });

  it("is deterministic — same input, same output", () => {
    const input = "Lets Eat lunch";
    expect(isFoodyTrigger(input)).toBe(isFoodyTrigger(input));
  });
});

describe("isOrderConfirm", () => {
  it("accepts confirm words on word boundaries", () => {
    for (const t of ["order", "place order", "checkout", "go", "confirm", "ja", "bestel"]) {
      expect(isOrderConfirm(t)).toBe(true);
    }
  });

  it("ignores partial-word matches and noise (word-boundary only)", () => {
    // "java" contains "ja", "good" contains "go", "reorder" contains "order" —
    // none on a word boundary, so none should confirm.
    for (const t of ["java", "good", "jacket", "reorder it later", "", undefined]) {
      expect(isOrderConfirm(t)).toBe(false);
    }
  });
});

describe("isResetCommand", () => {
  it("matches reset variants", () => {
    for (const t of ["reset", "reset foody", "start over", "cancel order", "vergeet alles"]) {
      expect(isResetCommand(t)).toBe(true);
    }
  });
  it("does not match ordinary text", () => {
    for (const t of ["resetting expectations is hard", "let's start", "", undefined]) {
      expect(isResetCommand(t)).toBe(false);
    }
  });
});

describe("extractChangeAddress", () => {
  it("pulls the address out of an explicit change command", () => {
    expect(extractChangeAddress("change address to Meir 1, Antwerpen")).toBe("Meir 1, Antwerpen");
    expect(extractChangeAddress("change my address to Grote Markt 1, 2000 Antwerpen")).toBe(
      "Grote Markt 1, 2000 Antwerpen",
    );
    expect(extractChangeAddress("deliver to Veldstraat 1, 9000 Gent")).toBe("Veldstraat 1, 9000 Gent");
  });

  it("returns null when there's no address to change", () => {
    expect(extractChangeAddress("what's on the menu?")).toBeNull();
    expect(extractChangeAddress("")).toBeNull();
    expect(extractChangeAddress(undefined)).toBeNull();
  });
});
