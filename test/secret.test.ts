import { describe, it, expect } from "vitest";
import { inspect } from "node:util";
import { Secret, isSecret, reveal } from "../src/secret";

describe("Secret", () => {
  it("reveals the real value only on request", () => {
    const code = Secret.of("CARD-12345-PIN");
    expect(code.reveal()).toBe("CARD-12345-PIN");
  });

  it("redacts in JSON, even nested in an object", () => {
    const order = { id: "o1", card: Secret.of("CARD-12345-PIN") };
    expect(JSON.stringify(order)).toBe('{"id":"o1","card":"[redacted]"}');
  });

  it("redacts in string coercion and template literals", () => {
    const code = Secret.of("secret-value");
    expect(String(code)).toBe("[redacted]");
    expect(`${code}`).toBe("[redacted]");
  });

  it("redacts when inspected by the console", () => {
    expect(inspect(Secret.of("secret-value"))).toBe("Secret([redacted])");
    expect(inspect({ code: Secret.of("x") })).toContain("Secret([redacted])");
  });

  it("keeps the value out of object keys and spreads", () => {
    const code = Secret.of("hidden");
    expect(Object.keys(code)).toEqual([]);
    expect(JSON.stringify({ ...code })).toBe("{}");
  });

  it("guards and unwraps with the helpers", () => {
    expect(isSecret(Secret.of("x"))).toBe(true);
    expect(isSecret("x")).toBe(false);
    expect(reveal(Secret.of("x"))).toBe("x");
    expect(reveal("plain")).toBe("plain");
  });
});
