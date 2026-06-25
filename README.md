# oneclickdz

A typed client for the [OneClickDZ](https://oneclickdz.com) API. It handles the
recharges every Algerian integration ends up writing by hand: mobile top-ups for
Mobilis, Djezzy, and Ooredoo, ADSL and 4G internet cards, gift cards, and Navio
payment links.

The recharge endpoints are asynchronous: you send an order, then poll until it
settles. This client does that polling for you, keeps card secrets out of your
logs by default, and types every status so the compiler knows when a card code
is present.

It is meant for servers. Your API key grants full account and balance access, so
it must never reach the browser.

Published as `@syscli/oneclickdz`. It needs Node 18 or newer, uses the global
`fetch`, and ships no runtime dependencies.

## Install

```sh
npm install @syscli/oneclickdz
```

This is an early scaffold. The client surface lands over the next releases. See
[CHANGELOG](./CHANGELOG.md).

## License

MIT. See [LICENSE](./LICENSE).
