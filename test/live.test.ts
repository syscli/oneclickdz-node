// Live tests against the real API. They run only when ONECLICKDZ_API_KEY is set
// and are skipped otherwise, so the normal suite stays offline and fast.
//
//   ONECLICKDZ_API_KEY=sk_sandbox_... npx vitest run test/live.test.ts
//
// Reads are safe to run on any key. The write block also needs
// ONECLICKDZ_LIVE_WRITE=1 and a sandbox key, so nothing here can spend real
// balance by accident. Point it at a sandbox key.

import { describe, it, expect } from "vitest";
import { OneClickDZ } from "../src/client";

const KEY = process.env.ONECLICKDZ_API_KEY;
const WRITE = process.env.ONECLICKDZ_LIVE_WRITE === "1";

// Built lazily so an empty key never throws at collection time.
const client = (): OneClickDZ => new OneClickDZ({ key: KEY ?? "" });

describe.skipIf(!KEY)("live reads", () => {
  it("pings the service", async () => {
    const health = await client().ping();
    expect(health.api).toBeDefined();
  }, 20_000);

  it("validates the key and reports its environment", async () => {
    const result = await client().validate();
    expect(result.apiKey.type).toMatch(/SANDBOX|PRODUCTION/);
    console.log(`live key: ${result.apiKey.type}, scope ${result.apiKey.scope}`);
  }, 20_000);

  it("reads the balance", async () => {
    const balance = await client().account.balance();
    expect(typeof balance.balance).toBe("number");
  }, 20_000);

  it("lists mobile plans", async () => {
    const plans = await client().mobile.plans();
    expect(Array.isArray(plans.dynamicPlans)).toBe(true);
    expect(Array.isArray(plans.fixedPlans)).toBe(true);
  }, 20_000);

  it("lists internet products for ADSL", async () => {
    const products = await client().internet.products("ADSL");
    expect(Array.isArray(products.products)).toBe(true);
  }, 20_000);

  it("loads the gift-card catalog", async () => {
    const catalog = await client().giftCards.catalog();
    expect(Array.isArray(catalog.categories)).toBe(true);
  }, 20_000);
});

describe.skipIf(!KEY || !WRITE)("live writes (sandbox only)", () => {
  it("sends a sandbox mobile top-up and waits for it to settle", async () => {
    const result = await client().validate();
    expect(result.apiKey.type).toBe("SANDBOX");

    const topup = await client().mobile.sendAndWait(
      {
        plan_code: "PREPAID_DJEZZY",
        MSSIDN: "0778037340",
        amount: 500,
        ref: `live-${Date.now()}`,
      },
      { intervalMs: 5000, maxAttempts: 24 },
    );

    expect(["FULFILLED", "REFUNDED", "UNKNOWN_ERROR"]).toContain(topup.status);
    console.log(`live top-up settled as ${topup.status}`);
  }, 130_000);
});
