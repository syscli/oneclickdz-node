// Shared types: the response status unions every product polls against, and the
// account-level entities. Product-specific entities (plans, products, gift-card
// catalogs, payment links) live with their resources.

import type { Pagination } from "./http";

/**
 * Where a mobile or internet top-up sits in its lifecycle. PENDING and HANDLING
 * are in-flight; the rest are final. QUEUED only appears for internet orders.
 * UNKNOWN_ERROR means the outcome is undecided and can still settle within 24h,
 * which is why a top-up should not be treated as failed the moment it shows up.
 */
export type TopupStatus =
  | "PENDING"
  | "HANDLING"
  | "QUEUED"
  | "FULFILLED"
  | "REFUNDED"
  | "UNKNOWN_ERROR";

/** A gift-card order's lifecycle. PARTIALLY_FILLED means some cards came through. */
export type GiftOrderStatus =
  | "HANDLING"
  | "FULFILLED"
  | "PARTIALLY_FILLED"
  | "REFUNDED";

/** A Navio payment link's lifecycle. */
export type PaymentStatus = "PENDING" | "CONFIRMED" | "FAILED";

/** The top-up statuses at which polling stops. */
export const TOPUP_TERMINAL: readonly TopupStatus[] = [
  "FULFILLED",
  "REFUNDED",
  "UNKNOWN_ERROR",
];

/** The gift-card order statuses at which polling stops. */
export const GIFT_TERMINAL: readonly GiftOrderStatus[] = [
  "FULFILLED",
  "PARTIALLY_FILLED",
  "REFUNDED",
];

/** The payment statuses at which polling stops. */
export const PAYMENT_TERMINAL: readonly PaymentStatus[] = [
  "CONFIRMED",
  "FAILED",
];

export type KeyType = "SANDBOX" | "PRODUCTION";
export type KeyScope = "READ-WRITE" | "READ-ONLY";

export interface ApiKeyInfo {
  key: string;
  isEnabled: boolean;
  type: KeyType;
  /** Allowed source IPs. An empty array means any IP is accepted. */
  allowedips: string[];
  scope: KeyScope;
}

/** What `validate()` returns: the account name and the key's own settings. */
export interface ValidateResult {
  username: string;
  apiKey: ApiKeyInfo;
}

/** What `ping()` returns: the API's own status and each operator's reachability. */
export interface ServiceHealth {
  api: string;
  operators: Record<string, string>;
}

export interface Balance {
  /** Current account balance in dinars. */
  balance: number;
}

export interface Transaction {
  _id: string;
  /** The kind of movement, such as a top-up or a deposit. */
  type: string;
  /** The direction of the movement: increment or decrement. */
  operation: string;
  amount: number;
  oldBalance: number;
  newBalance: number;
  /** The id of the related order, when there is one. */
  objid: string;
  note: string;
  time: string;
}

export interface TransactionsParams {
  page?: number;
  pageSize?: number;
  /** ISO 8601 start of the date filter. Pass `to` alongside it. */
  from?: string;
  /** ISO 8601 end of the date filter. Pass `from` alongside it. */
  to?: string;
}

/** A paginated `{ items, pagination }` payload, the shape list endpoints return. */
export interface ItemsPage<T> {
  items: T[];
  pagination: Pagination;
}
