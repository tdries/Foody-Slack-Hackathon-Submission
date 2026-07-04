import { describe, it, expect } from "vitest";
import { addressKey, sessionKey } from "../src/state";
import { categoryById, CATEGORIES } from "../src/categories";

describe("state keys", () => {
  it("namespaces the sticky address book by user", () => {
    expect(addressKey("U123ABC")).toBe("addr_U123ABC");
  });

  it("builds a filesystem-safe session key (no dots from the Slack ts)", () => {
    expect(sessionKey("C0LUNCH", "1700000000.000200")).toBe("sess_C0LUNCH_1700000000-000200");
    expect(sessionKey("C0LUNCH", "1700000000.000200")).not.toContain(".");
  });
});

describe("categories", () => {
  it("resolves a known category id", () => {
    expect(categoryById("kebab")?.label).toBe("Kebab");
  });
  it("returns null for an unknown id", () => {
    expect(categoryById("nope")).toBeNull();
  });
  it("every category id is unique", () => {
    const ids = CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("category match patterns behave as expected", () => {
    expect(CATEGORIES.find((c) => c.id === "kebab")!.match.test("Antwerpen Dürüm & Shawarma")).toBe(true);
    expect(CATEGORIES.find((c) => c.id === "sushi")!.match.test("Pizza Roma")).toBe(false);
  });
});
