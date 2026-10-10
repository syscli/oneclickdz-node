# Changelog

## [Unreleased]

- Every error from `send` and `sendAndWait` (mobile and internet) now carries
  the order reference on `error.ref`, and the wait helpers add `error.orderId`
  once the order was accepted. `placeOrderAndWait` adds `error.orderId` too.
  The README now says plainly: after a NetworkError or a timeout, reconcile with
  `error.ref` before sending again. The old claim that a resend reused the same
  generated ref was wrong.
- A POST is no longer retried on 429 by default. Set `retry.retryPostOn429` to
  opt back in.
- `Retry-After` waits are capped at 60 seconds and end early when the caller's
  signal aborts.
- The request timeout now covers reading the body, and the client removes its
  abort listener from the caller's signal after each request.
- Breaking: `validate()` returns `apiKey.key` as a `Secret<string>`. Call
  `.reveal()` where the raw key was read.
- `getOffers` accepts a `ref` and documents that it places a real 50 DZD order.
- List and paginate calls take an `AbortSignal`.
- `sellPrice` rounds up so a price never lands under cost, and throws a
  `RangeError` on a negative or non-finite markup.
- The README recommends `checkById` over `checkByRef`, since the API can rewrite
  the reference.
- Packaging: `./package.json` is exported, source maps are no longer shipped,
  `prepublishOnly` runs typecheck and tests, and the unused `msw` dev dependency
  is gone.
- CI runs with read-only permissions, audits production dependencies, smoke
  tests the packed tarball, and typechecks tests and examples.

## [0.2.0] - 2026-06-27

- `mobile.getOffers(operator, number)` lists the operator offers available for a
  number, driving the GETMENU plans and returning each offer's `plan_code` and
  `amount`.
- `sendAndWait` and `getOffers` now poll by the top-up id from the send response
  rather than the order reference, which the API rewrites. Status checks are more
  reliable as a result.
- Navio payments confirmed end to end against the live API. `createLink` and
  `checkPayment` parse as typed; `transactionDetails.createdDate` is optional,
  since it is absent while a payment is still pending.
- Continuous integration runs typecheck, tests, and the build on Node 18, 20,
  and 22.

## [0.1.0] - 2026-06-25

First release. A typed client for the OneClickDZ v3 API, server-side, with no
runtime dependencies.

- `OneClickDZ` client with resources for core, account, mobile, internet, gift
  cards, and Navio payments.
- Mobile and internet top-ups: `send`, status checks by reference and by id,
  `sendAndWait`, and paginated history.
- Gift cards: catalog, product check, order placement, `placeOrderAndWait`, and
  paginated orders.
- Navio payment links: `createLink`, `checkPayment`, and `waitForPayment`.
- Card codes returned wrapped in `Secret`, redacted in logs until revealed.
- Auto-generated order references for safe resends, with `DuplicateRefError` for
  a reused reference.
- Client-side validation for numbers, amounts, and quantities.
- Error hierarchy mapped from the API codes, 429 retry honoring `Retry-After`,
  and read-only retry on 5xx and network failures.
