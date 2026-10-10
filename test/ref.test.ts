import { describe, it, expect } from "vitest";
import { generateRef } from "../src/ref";

describe("generateRef", () => {
  it("prefixes a unique value", () => {
    const a = generateRef();
    const b = generateRef();
    expect(a).toMatch(/^ocd-/);
    expect(a).not.toBe(b);
  });

  it("takes a custom prefix", () => {
    expect(generateRef("shop")).toMatch(/^shop-/);
  });
});
