// Resale pricing. The API returns your wholesale cost on internet products and
// gift-card types, and the docs are blunt that you must strip it and add your own
// markup before showing anything to a customer. Resellers are the whole audience
// here, so that step lives in the SDK: pick a markup, get back a customer-safe
// list with the cost gone and a sell price in its place.

import type { InternetProduct } from "./resources/internet";
import type { GiftProductType } from "./resources/giftcards";

/** A markup as a percentage of cost, or a flat number of dinars added on top. */
export type Markup = { percent: number } | { flat: number };

/** Apply a markup to a wholesale cost and round to a whole dinar. */
export function sellPrice(cost: number, markup: Markup): number {
  const raw =
    "percent" in markup ? cost * (1 + markup.percent / 100) : cost + markup.flat;
  return Math.round(raw);
}

/** An internet product as a customer should see it: face value, sell price, stock. */
export interface CustomerInternetProduct {
  value: number;
  price: number;
  available: boolean;
}

/**
 * Turn the raw internet products into a customer-facing list. The wholesale
 * `cost` is dropped and `price` is your sell price for the card's face value.
 */
export function priceInternetProducts(
  products: InternetProduct[],
  markup: Markup,
): CustomerInternetProduct[] {
  return products.map((p) => ({
    value: p.value,
    price: sellPrice(p.cost, markup),
    available: p.available,
  }));
}

/** A gift-card denomination as a customer should see it, with cost removed. */
export interface CustomerGiftType {
  id: string;
  name: string;
  price: number;
  inStock: boolean;
}

/**
 * Turn a product's types into a customer-facing list. The wholesale `price` is
 * replaced by your sell price, and stock collapses to a single boolean.
 */
export function priceGiftTypes(
  types: GiftProductType[],
  markup: Markup,
): CustomerGiftType[] {
  return types.map((t) => ({
    id: t.id,
    name: t.name,
    price: sellPrice(t.price, markup),
    inStock: t.quantity > 0,
  }));
}
