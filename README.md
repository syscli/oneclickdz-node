# oneclickdz

A typed client for the [OneClickDZ](https://oneclickdz.com) API. It covers the
recharges every Algerian integration ends up writing by hand: mobile top-ups for
Mobilis, Djezzy, and Ooredoo, ADSL and 4G internet cards, gift cards, and Navio
payment links.

Two things set it apart. The recharge endpoints are asynchronous, so you send an
order and then poll until it settles; this client runs that loop for you and
hands back a fully typed, settled result. And the card codes a recharge delivers
come back wrapped so they stay out of your logs until you ask for them.

It is meant for servers. Your access token grants account and balance access, so
it must never reach the browser.

Published as `@syscli/oneclickdz`. It needs Node 18 or newer, uses the global
`fetch`, and ships no runtime dependencies.

## Install

```sh
npm install @syscli/oneclickdz
```

## Quick start

```ts
import { OneClickDZ } from "@syscli/oneclickdz";

const oneclick = new OneClickDZ({
  key: process.env.ONECLICKDZ_API_KEY!,
});

// Confirm the key and see which environment it belongs to.
const { username, apiKey } = await oneclick.validate();
console.log(username, apiKey.type); // "boutique-batna", "SANDBOX"

// Send a Djezzy top-up and wait for it to settle.
const topup = await oneclick.mobile.sendAndWait({
  plan_code: "PREPAID_DJEZZY",
  MSSIDN: "0778037340",
  amount: 500,
});

console.log(topup.status); // "FULFILLED"
```

## Keys and environments

Every key is either sandbox or production. Sandbox runs the full flow without
touching real balance, so build against it first. Read the environment off the
key with `validate()` before a deploy goes live:

```ts
const { apiKey } = await oneclick.validate();
if (apiKey.type !== "PRODUCTION") {
  throw new Error("Refusing to start with a sandbox key in production.");
}
```

The key `validate()` echoes back on `apiKey.key` is wrapped in a `Secret`, so
logging the result does not leak it. The token goes over the wire as the
`X-Access-Token` header. After five failed
auth attempts the API blocks your IP for fifteen minutes, so cache a working key
rather than guessing.

## Sending and waiting

A send returns an id and a reference; the order then moves from `PENDING` through
`HANDLING` to a final state. You can drive that yourself:

```ts
const { topupId } = await oneclick.mobile.send({
  plan_code: "PREPAID_MOBILIS",
  MSSIDN: "0661234567",
  amount: 1000,
});

const status = await oneclick.mobile.checkById(topupId);
```

Prefer `checkById` with the `topupId` from the send. The API can rewrite the
order reference, so a lookup by ref is the fallback for when you never got an
id back.

Or let the client poll for you. `sendAndWait` checks every five seconds and
resolves once the order is `FULFILLED`, `REFUNDED`, or `UNKNOWN_ERROR`:

```ts
const topup = await oneclick.mobile.sendAndWait({
  plan_code: "PREPAID_OOREDOO",
  MSSIDN: "0551234567",
  amount: 200,
});

if (topup.status === "REFUNDED") {
  console.log(topup.refund_message, topup.suggested_offers);
}
```

Pass an `AbortSignal` to stop waiting, and override the cadence when you need to:

```ts
await oneclick.giftCards.placeOrderAndWait(order, {
  intervalMs: 5000,
  maxAttempts: 120,
  signal: controller.signal,
});
```

A wait that never settles inside its budget throws a `PollTimeoutError` that
carries the last status it saw on `error.last`. Any error from a `*AndWait`
helper carries `error.ref` and, once the order was accepted, `error.orderId`
(the topup id or gift order id), so you can check on the order later instead of
placing it again.

## Available offers for a number

Some numbers have operator offers that are cheaper or larger than a plain top-up.
`getOffers` reads them through the GETMENU plans.

**It places a real 50 DZD order.** The operator is expected to refund it and the
offers are read off the refunded order, but the amount is held until the order
settles, and one that ends in `UNKNOWN_ERROR` may not come back right away. Pass
a `ref` if you want to track the probe as your own order. Each offer carries the
`plan_code` and `amount` you would pass to `send` to buy it:

```ts
const offers = await oneclick.mobile.getOffers("Djezzy", "0778037340", {
  ref: "offers-1043",
});
// [{ typename: "HAYLA BEZZEF 100", plan_code: "MIX100_DJEZZY", amount: 100 }, ...]

const offer = offers[0];
if (offer) {
  await oneclick.mobile.sendAndWait({
    plan_code: offer.plan_code,
    MSSIDN: "0778037340",
    amount: offer.amount,
  });
}
```

## References and safe resends

Every send takes an optional `ref`. Leave it out and the client generates one.
Either way, any error from `send` or `sendAndWait` carries the reference on
`error.ref`.

**After a `NetworkError` or a timeout, do not call `send` again.** The top-up may
have gone through, and a second `send` without the same ref is a second order.
Reconcile first: look the order up with `checkByRef(error.ref)`, or find it in
`list()`. Only if it is not there, resend with the same `ref`; the API rejects a
reused ref with a `DuplicateRefError` rather than charging twice. Passing your
own ref, tied to your own order id, makes this easiest:

```ts
import { DuplicateRefError, NetworkError } from "@syscli/oneclickdz";

try {
  await oneclick.mobile.send({ plan_code, MSSIDN, amount, ref: "order-1043" });
} catch (error) {
  if (error instanceof NetworkError) {
    // Unknown outcome. Check before doing anything else.
    const existing = await oneclick.mobile.checkByRef("order-1043");
  } else if (error instanceof DuplicateRefError) {
    // The first order stands. Read it rather than sending again.
  }
}
```

Gift card orders take no reference at all, so a failed `placeOrder` cannot be
deduplicated by the API. After a `NetworkError` or a timeout, look for the order
in `giftCards.listOrders()` before placing it again.

## Card codes are secrets

Internet recharges and gift cards return codes the customer keys in. Those are
bearer credentials, so the client wraps them. A wrapped value renders as
`[redacted]` in logs, JSON, and string interpolation, and gives up its contents
only through `reveal()`:

```ts
const order = await oneclick.giftCards.checkOrder(orderId);

for (const card of order.cards) {
  console.log(card.value); // [redacted]
  sendToCustomer(card.value.reveal()); // the real code, read on purpose
}

JSON.stringify(order); // the codes do not appear
```

The same applies to `card_code` on a settled internet top-up.

## Gift cards

Load the catalog once and cache it; it changes rarely. Check a product for live
pricing and stock, place the order, then wait for the codes:

```ts
const catalog = await oneclick.giftCards.catalog();
const details = await oneclick.giftCards.checkProduct("psn-us");

const type = details.types.find((t) => t.quantity > 0);
if (!type) throw new Error("Out of stock.");

const order = await oneclick.giftCards.placeOrderAndWait({
  productId: "psn-us",
  typeId: type.id,
  quantity: 2,
});

if (order.status === "PARTIALLY_FILLED") {
  console.log(`Only ${order.fulfilled_quantity} of ${order.quantity} came through.`);
}
```

## Payments with Navio

Create a hosted payment link, send the customer to its URL, then poll the
reference. A link stays open for twenty minutes:

```ts
const link = await oneclick.payments.createLink({
  productInfo: { title: "Commande 1043", amount: 4500 },
  feeMode: "CUSTOMER_FEE",
  redirectUrl: "https://shop.example.dz/merci",
});

console.log(link.paymentUrl);

const payment = await oneclick.payments.waitForPayment(link.paymentRef);
console.log(payment.status); // "CONFIRMED" or "FAILED"
```

## Resale pricing

The API returns your wholesale `cost` on internet products and gift-card types,
and that figure must never reach a customer. Pick a markup and get back a clean,
customer-facing list with the cost gone:

```ts
import { priceInternetProducts } from "@syscli/oneclickdz";

const products = await oneclick.internet.products("4G");
const forSale = priceInternetProducts(products.products, { percent: 10 });
// [{ value: 1000, price: 1078, available: true }, ...] and no cost field

import { sellPrice } from "@syscli/oneclickdz";
sellPrice(480, { flat: 100 }); // 580
```

`priceGiftTypes` does the same for a gift product's denominations. Prices round
up to a whole dinar, so a sale never lands under cost, and a negative or
non-finite markup throws a `RangeError`.

## Validation

Inputs are checked before the request leaves. A wrong number for the service, an
amount that is not a whole dinar figure, a payment under the floor, or a quantity
below one throws a `ValidationError` with one issue per problem, and spends no
request:

```ts
import { ValidationError } from "@syscli/oneclickdz";

try {
  await oneclick.internet.send({ type: "4G", number: "033123456", value: 1500 });
} catch (error) {
  if (error instanceof ValidationError) {
    for (const issue of error.issues) console.warn(issue.field, issue.message);
  }
}
```

## Errors

Every failure is a `OneClickError`, so you can catch one type and branch on it or
on its stable `code`:

```ts
import {
  AuthError,
  InsufficientBalanceError,
  DuplicateRefError,
  RateLimitError,
  ServiceError,
} from "@syscli/oneclickdz";
```

`AuthError` (401), `InsufficientBalanceError` and `DuplicateRefError` (403),
`ValidationError` (400 or client-side), `NotFoundError` (404), `RateLimitError`
(429, with `retryAfter`), and `ServiceError` (5xx) all carry `status`, the API's
`code`, the `requestId`, and the parsed `body`.

## Rate limits and retries

The API allows 60 requests a minute on sandbox and 120 on production. Reads are
retried up to three attempts on a 429, a 5xx, or a dropped connection, waiting
the `Retry-After` (capped at 60 seconds) or an exponential backoff. A send is
never retried by default: a top-up that timed out may still have gone through,
so the client never blindly resends a charge. If you trust the API to reject a
429 before processing, opt in for sends:

```ts
new OneClickDZ({ key, retry: { retryPostOn429: true } });
```

A server error on a send should not be refunded right away either; the docs
note it can still settle within a day. The timeout covers the whole request,
body included, and an `AbortSignal` also cancels a wait between retries.

## Pagination

List endpoints return a `Page`. Step through it with `next()`, or let an iterator
walk every page:

```ts
const page = await oneclick.account.transactions({ pageSize: 50 });
console.log(page.items, page.totalResults, page.hasMore);

for await (const tx of oneclick.account.paginateTransactions()) {
  console.log(tx.type, tx.amount, tx.newBalance);
}
```

Every list and paginate call takes an `AbortSignal` as its second argument, and
`next()` reuses it.

## Limitations

Worth knowing before you build on it:

- **Server only.** The token grants account and balance access. There is no
  browser build, on purpose.
- **No webhooks yet.** The API does not offer them at the time of writing, so the
  only way to learn an outcome is to poll. The `*AndWait` helpers and the
  pollers are built around that. Webhook support can be added once it ships.
- **Navio needs merchant onboarding.** `createLink` returns a 403 until the
  account completes merchant validation in the dashboard. The client surfaces
  that as a `ForbiddenError`; it is an account step, not a code change.
- **A QUEUED internet order is slow.** It can take up to 48 hours, well past the
  default polling window. Treat `QUEUED` as accepted and check back later rather
  than waiting in process.
- **Wholesale prices are not for display.** Product `cost` and `price` are your
  rates. Apply your own markup and do not show them to customers.

## Development

```sh
npm install
npm run typecheck  # src, then tests and examples
npm test           # vitest
npm run build      # tsup, dual ESM and CJS plus types
```

A small set of live tests run against the real API when `ONECLICKDZ_API_KEY` is
set, and are skipped otherwise. Point them at a sandbox key.

## License

MIT. See [LICENSE](./LICENSE).
