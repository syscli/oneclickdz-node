import { describe, it, expect } from "vitest";
import {
  sellPrice,
  priceInternetProducts,
  priceGiftTypes,
} from "../src/pricing";

describe("sellPrice", () => {
  it("adds a percentage and rounds up to a whole dinar", () => {
    expect(sellPrice(1960, { percent: 10 })).toBe(2156);
    expect(sellPrice(490, { percent: 12.5 })).toBe(552);
  });

  it("adds a flat amount", () => {
    expect(sellPrice(980, { flat: 50 })).toBe(1030);
  });

  it("never sells under a fractional cost", () => {
    expect(sellPrice(100.4, { percent: 0 })).toBe(101);
  });

  it("rejects a negative or non-finite markup", () => {
    expect(() => sellPrice(100, { percent: -5 })).toThrow(RangeError);
    expect(() => sellPrice(100, { flat: Number.NaN })).toThrow(RangeError);
    expect(() => sellPrice(100, { flat: Infinity })).toThrow(RangeError);
  });
});

describe("priceInternetProducts", () => {
  it("drops cost and prices the face value for the customer", () => {
    const view = priceInternetProducts(
      [
        { cost: 1960, value: 2000, available: true },
        { cost: 490, value: 500, available: false },
      ],
      { percent: 5 },
    );
    expect(view).toEqual([
      { value: 2000, price: 2058, available: true },
      { value: 500, price: 515, available: false },
    ]);
    expect(view[0]).not.toHaveProperty("cost");
  });
});

describe("priceGiftTypes", () => {
  it("replaces wholesale price with the sell price and collapses stock", () => {
    const view = priceGiftTypes(
      [
        { id: "t1", name: "PSN 500", price: 480, quantity: 12 },
        { id: "t2", name: "PSN 1000", price: 960, quantity: 0 },
      ],
      { flat: 100 },
    );
    expect(view).toEqual([
      { id: "t1", name: "PSN 500", price: 580, inStock: true },
      { id: "t2", name: "PSN 1000", price: 1060, inStock: false },
    ]);
  });
});
