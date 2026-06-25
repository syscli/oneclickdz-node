// Create a Navio payment link and poll it until the customer pays.
//
//   ONECLICKDZ_API_KEY=... npx tsx examples/payment-link.ts
//
// Use a sandbox key. The link stays open for twenty minutes.

import { OneClickDZ } from "../src";

const oneclick = new OneClickDZ({ key: process.env.ONECLICKDZ_API_KEY ?? "" });

async function main() {
  const link = await oneclick.payments.createLink({
    productInfo: {
      title: "Commande 1043",
      description: "Casque audio, livraison Batna",
      amount: 4500,
    },
    feeMode: "CUSTOMER_FEE",
  });

  console.log(`Send the customer to: ${link.paymentUrl}`);
  console.log(`Reference: ${link.paymentRef}`);

  // Stop polling after two minutes for this demo rather than the full window.
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 120_000);

  const payment = await oneclick.payments.waitForPayment(link.paymentRef, {
    signal: controller.signal,
  });

  console.log(`Payment ${payment.status}: ${payment.message}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
