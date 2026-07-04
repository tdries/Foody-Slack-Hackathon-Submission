import { describe, it, expect } from "vitest";
import {
  isFoodyTrigger,
  isOrderConfirm,
  isResetCommand,
  extractChangeAddress,
  sanitizeAddress,
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
      "ik heb trek",
      "trek in pizza",
      "/foody",
    ]) {
      expect(isFoodyTrigger(t), `should trigger: ${t}`).toBe(true);
    }
  });

  it("does not hijack unrelated messages", () => {
    for (const t of [
      "hungry for adventure",
      "let's meet at 3",
      "the eatery downtown is nice",
      // regression: short Dutch words used to match as substrings
      "we vertrekken om 5u",
      "star trek marathon tonight",
      "de betrekking is geregeld",
      "",
      undefined,
    ]) {
      expect(isFoodyTrigger(t), `should NOT trigger: ${t}`).toBe(false);
    }
  });
});

describe("isOrderConfirm", () => {
  it("accepts whole-message confirms", () => {
    for (const t of ["order", "Order now!", "place order", "place the order", "checkout", "go", "confirm", "ja", "yes", "bestel", "bestellen", "  order now.  "]) {
      expect(isOrderConfirm(t), `should confirm: ${t}`).toBe(true);
    }
  });

  it("never confirms from a substring in conversation (regression: placed real orders)", () => {
    for (const t of [
      "good to go?",
      "can we order more fries",
      "how long does the order take?",
      "ja maar ik wil sushi",
      "reorder it later",
      "java",
      "confirm with the team first",
      "",
      undefined,
    ]) {
      expect(isOrderConfirm(t), `should NOT confirm: ${t}`).toBe(false);
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

describe("sanitizeAddress", () => {
  it("strips Slack markdown wrappers and courtesy words (regression: stored 'to Dorp 48, 2230 Herselt_')", () => {
    expect(sanitizeAddress("_to Dorp 48, 2230 Herselt_")).toBe("Dorp 48, 2230 Herselt");
    expect(sanitizeAddress("to Dorp 48, 2230 Herselt")).toBe("Dorp 48, 2230 Herselt");
    expect(sanitizeAddress("*Meir 1, 2000 Antwerpen*")).toBe("Meir 1, 2000 Antwerpen");
    expect(sanitizeAddress("is Veldstraat 1, Gent")).toBe("Veldstraat 1, Gent");
  });

  it("leaves clean addresses alone, including streets starting with To-", () => {
    expect(sanitizeAddress("Meir 1, 2000 Antwerpen")).toBe("Meir 1, 2000 Antwerpen");
    expect(sanitizeAddress("Tolstraat 5, Antwerpen")).toBe("Tolstraat 5, Antwerpen");
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

  it("sanitizes markdown-wrapped and 'to'-prefixed captures", () => {
    expect(extractChangeAddress("change address to _Dorp 48, 2230 Herselt_")).toBe("Dorp 48, 2230 Herselt");
    expect(extractChangeAddress("address: *Meir 1*")).toBe("Meir 1");
  });

  it("returns null when there's no address to change", () => {
    expect(extractChangeAddress("what's on the menu?")).toBeNull();
    expect(extractChangeAddress("")).toBeNull();
    expect(extractChangeAddress(undefined)).toBeNull();
  });
});
