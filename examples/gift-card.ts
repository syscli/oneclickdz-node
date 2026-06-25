// Browse the catalog, place a gift-card order, wait for it, and read the codes.
//
//   ONECLICKDZ_API_KEY=... npx tsx examples/gift-card.ts
//
// Use a sandbox key.

import { OneClickDZ } from "../src";

const oneclick = new OneClickDZ({ key: process.env.ONECLICKDZ_API_KEY ?? "" });

async function main() {
  const catalog = await oneclick.giftCards.catalog();
  const product = catalog.categories[0]?.products.find((p) => p.enabled);
  if (!product) {
    console.log("No enabled product in the catalog.");
    return;
  }

  const details = await oneclick.giftCards.checkProduct(product.id);
  const type = details.types.find((t) => t.quantity > 0);
  if (!type) {
    console.log(`${details.productTitle} is out of stock.`);
    return;
  }

  const order = await oneclick.giftCards.placeOrderAndWait({
    productId: product.id,
    typeId: type.id,
    quantity: 1,
  });

  console.log(`Order is ${order.status}, ${order.fulfilled_quantity} card(s) delivered.`);
  for (const card of order.cards) {
    // The code prints redacted unless you reveal it on purpose.
    console.log("card:", String(card.value));
    // Hand the real value to the customer, never to a log.
    deliver(card.value.reveal(), card.serial.reveal());
  }
}

function deliver(code: string, serial: string) {
  void code;
  void serial;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
