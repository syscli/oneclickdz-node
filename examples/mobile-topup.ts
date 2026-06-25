// Send a mobile top-up and wait for it to settle.
//
//   ONECLICKDZ_API_KEY=... npx tsx examples/mobile-topup.ts
//
// Use a sandbox key. The amount is not deducted from a real balance.

import { OneClickDZ, ValidationError } from "../src";

const oneclick = new OneClickDZ({ key: process.env.ONECLICKDZ_API_KEY ?? "" });

async function main() {
  const { apiKey } = await oneclick.validate();
  console.log(`Key is ${apiKey.type}, scope ${apiKey.scope}.`);

  try {
    const topup = await oneclick.mobile.sendAndWait({
      plan_code: "PREPAID_DJEZZY",
      MSSIDN: "0778037340",
      amount: 500,
      ref: `demo-${Date.now()}`,
    });

    console.log(`Status: ${topup.status}`);
    if (topup.status === "REFUNDED") {
      console.log(`Refunded: ${topup.refund_message}`);
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      for (const issue of error.issues) {
        console.error(`${issue.field}: ${issue.message}`);
      }
      return;
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
