// Gift cards: a catalog of products, each with one or more denominations, that
// you order by quantity and then poll until the codes come through. An order can
// settle as PARTIALLY_FILLED when only some of the cards were in stock. Every
// card's code and serial come back wrapped in a Secret, since these are bearer
// credentials that must not be logged.

import { Resource, type Page } from "./base";
import type { Envelope, Pagination } from "../http";
import type { GiftOrderStatus } from "../types";
import { GIFT_TERMINAL } from "../types";
import { pollUntil, type PollOptions } from "../poll";
import { Issues, requireText } from "../validate";
import { Secret } from "../secret";

export interface GiftProductSummary {
  id: string;
  title: string;
  enabled: boolean;
  /** The region the product is valid in, such as france or turkey. Absent on some products. */
  region?: string;
}

export interface GiftCategory {
  title: string;
  products: GiftProductSummary[];
}

export interface GiftCatalog {
  categories: GiftCategory[];
  totalCategories?: number;
  totalProducts?: number;
}

export interface GiftProductType {
  id: string;
  /** The denomination label, such as "PSN 500 DA". */
  name: string;
  /** Your wholesale price. Do not show it to end users. */
  price: number;
  /** Stock on hand. Zero means out of stock. */
  quantity: number;
}

export interface GiftProductDetails {
  productId: string;
  productTitle: string;
  types: GiftProductType[];
}

export interface GiftOrderInput {
  /** A product id from the catalog. */
  productId: string;
  /** A type id from `checkProduct`. */
  typeId: string;
  /** How many cards to buy. At least one. */
  quantity: number;
}

export interface GiftOrderResult {
  orderId: string;
}

/** A delivered card. Both fields are secrets; call `.reveal()` to read them. */
export interface GiftCard {
  value: Secret<string>;
  serial: Secret<string>;
}

export interface GiftOrder {
  status: GiftOrderStatus;
  quantity: number;
  fulfilled_quantity: number;
  fulfilled_amount: number;
  price_per_card: number;
  /** Filled once the order is FULFILLED or PARTIALLY_FILLED. */
  cards: GiftCard[];
  /** Present in the order list; the single-order check omits these. */
  _id?: string;
  product?: string;
  type?: string;
  time?: string;
}

export interface GiftOrdersParams {
  page?: number;
  pageSize?: number;
  from?: string;
  to?: string;
}

interface RawCard {
  value?: string;
  serial?: string;
}

interface RawGiftOrder {
  status: GiftOrderStatus;
  quantity: number;
  fulfilled_quantity: number;
  fulfilled_amount: number;
  price_per_card: number;
  cards?: RawCard[];
  _id?: string;
  product?: string;
  type?: string;
  time?: string;
}

/** Wrap each card's code and serial so neither can be logged by accident. */
function toOrder(raw: RawGiftOrder): GiftOrder {
  const cards = (raw.cards ?? []).map((card) => ({
    value: Secret.of(card.value ?? ""),
    serial: Secret.of(card.serial ?? ""),
  }));
  return { ...raw, cards };
}

function extractOrders(env: Envelope<unknown>): {
  items: GiftOrder[];
  pagination: Pagination;
} {
  const d = (env.data ?? {}) as {
    items?: RawGiftOrder[];
    pagination?: Pagination;
  };
  return {
    items: (d.items ?? []).map(toOrder),
    pagination:
      d.pagination ?? { page: 1, pageSize: 0, totalPages: 1, totalResults: 0 },
  };
}

function validateOrder(input: GiftOrderInput): void {
  const issues = new Issues();
  requireText(issues, input.productId, "productId");
  requireText(issues, input.typeId, "typeId");
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    issues.add("quantity", "must be a whole number of one or more");
  }
  issues.throwIfAny("The gift-card order did not pass validation.");
}

const isTerminal = (o: GiftOrder): boolean => GIFT_TERMINAL.includes(o.status);

export class GiftCards extends Resource {
  /** The full product catalog. Cache it; the docs say it changes rarely. */
  async catalog(signal?: AbortSignal): Promise<GiftCatalog> {
    const env = await this.http.request<{ categories?: GiftCategory[] }>(
      "GET",
      "gift-cards/catalog",
      { signal },
    );
    return {
      categories: env.data.categories ?? [],
      totalCategories: env.totalCategories as number | undefined,
      totalProducts: env.totalProducts as number | undefined,
    };
  }

  /** A product's denominations, with live pricing and stock. */
  checkProduct(
    productId: string,
    signal?: AbortSignal,
  ): Promise<GiftProductDetails> {
    return this.getData<GiftProductDetails>(
      `gift-cards/checkProduct/${encodeURIComponent(productId)}`,
      undefined,
      signal,
    );
  }

  /** Place an order. The product, type, and quantity are checked first. */
  async placeOrder(
    input: GiftOrderInput,
    signal?: AbortSignal,
  ): Promise<GiftOrderResult> {
    validateOrder(input);
    return this.postData<GiftOrderResult>(
      "gift-cards/placeOrder",
      input,
      signal,
    );
  }

  /** Read an order's status and, once settled, its cards. */
  async checkOrder(orderId: string, signal?: AbortSignal): Promise<GiftOrder> {
    const raw = await this.getData<RawGiftOrder>(
      `gift-cards/checkOrder/${encodeURIComponent(orderId)}`,
      undefined,
      signal,
    );
    return toOrder(raw);
  }

  /**
   * Place an order and wait for it to settle. Resolves once the order is
   * FULFILLED, PARTIALLY_FILLED, or REFUNDED. Gift cards can take longer than a
   * top-up, so this checks every 5 seconds for up to 10 minutes by default.
   */
  async placeOrderAndWait(
    input: GiftOrderInput,
    options: PollOptions = {},
  ): Promise<GiftOrder> {
    const { orderId } = await this.placeOrder(input, options.signal);
    return pollUntil(
      () => this.checkOrder(orderId, options.signal),
      isTerminal,
      { intervalMs: 5000, maxAttempts: 120, ...options },
    );
  }

  /** One page of past orders, newest first. */
  listOrders(
    params: GiftOrdersParams = {},
    signal?: AbortSignal,
  ): Promise<Page<GiftOrder>> {
    return this.fetchPage<GiftOrder>(
      "gift-cards/list",
      { ...params },
      extractOrders,
      signal,
    );
  }

  /** Every past order across every page, as an async iterator. */
  paginateOrders(
    params: GiftOrdersParams = {},
    signal?: AbortSignal,
  ): AsyncGenerator<GiftOrder> {
    return this.iterate(this.listOrders(params, signal));
  }
}
