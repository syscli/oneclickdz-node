// Mobile top-ups for Mobilis, Djezzy, and Ooredoo. Sending is asynchronous: you
// post an order, get back an id and a reference, then poll until it settles.
// `send` validates the number and amount client-side and fills in a reference
// when you leave one out. `sendAndWait` does the whole round trip for you.

import { Resource, type Page } from "./base";
import type { Envelope, Pagination } from "../http";
import type { TopupStatus } from "../types";
import { TOPUP_TERMINAL } from "../types";
import { pollUntil, type PollOptions } from "../poll";
import { generateRef } from "../ref";
import { Issues, isMobileNumber, isWholeAmount, requireText } from "../validate";

interface MobilePlanBase {
  code: string;
  name: string;
  operator: string;
  /**
   * Your wholesale cost factor. Absent on the wholesale `GROS_*` plans. Do not
   * show it to end users; apply your own markup.
   */
  cost?: number;
  isEnabled: boolean;
}

/** A plan whose amount you choose, within a range. */
export interface DynamicMobilePlan extends MobilePlanBase {
  min_amount: number;
  max_amount: number;
}

/** A plan with a fixed amount, such as a data pack. */
export interface FixedMobilePlan extends MobilePlanBase {
  amount: number;
}

export interface MobilePlans {
  dynamicPlans: DynamicMobilePlan[];
  fixedPlans: FixedMobilePlan[];
}

export interface MobileSendInput {
  /** A plan code from `plans()`, such as `PREPAID_DJEZZY`. */
  plan_code: string;
  /** The recipient number: ten digits starting 05, 06, or 07. */
  MSSIDN: string;
  /** Required for dynamic plans, within the plan's min and max. */
  amount?: number;
  /** Your order reference. One is generated when omitted. */
  ref?: string;
}

export interface MobileSendResult {
  topupId: string;
  topupRef: string;
}

/** A retry the API suggests after a refund, and the shape `getOffers` returns. */
export interface SuggestedOffer {
  typename: string;
  plan_code: string;
  amount: number;
}

/** The operators whose offers `getOffers` can list. */
export type MobileOperator = "Mobilis" | "Djezzy" | "Ooredoo";

/** An offer available for a number. The same shape as a suggested offer. */
export type MobileOffer = SuggestedOffer;

export interface MobileTopup {
  _id: string;
  ref?: string;
  status: TopupStatus;
  plan_code: string;
  MSSIDN: string;
  topup_amount: number;
  balance_amount: number;
  created_at: string;
  /** Present on a REFUNDED order, explaining why it did not go through. */
  refund_message?: string;
  /** Alternative offers to try after a refund. */
  suggested_offers?: SuggestedOffer[];
  follow_orderid?: string;
  retry_orderid?: string;
}

export interface MobileListParams {
  page?: number;
  pageSize?: number;
  from?: string;
  to?: string;
}

function extractTopups(env: Envelope<unknown>): {
  items: MobileTopup[];
  pagination: Pagination;
} {
  const d = (env.data ?? {}) as {
    items?: MobileTopup[];
    pagination?: Pagination;
  };
  return {
    items: d.items ?? [],
    pagination:
      d.pagination ?? { page: 1, pageSize: 0, totalPages: 1, totalResults: 0 },
  };
}

function validateSend(input: MobileSendInput): void {
  const issues = new Issues();
  requireText(issues, input.plan_code, "plan_code");
  if (typeof input.MSSIDN !== "string" || !isMobileNumber(input.MSSIDN)) {
    issues.add("MSSIDN", "is not a valid mobile number");
  }
  if (input.amount !== undefined && !isWholeAmount(input.amount)) {
    issues.add("amount", "must be a whole number of dinars");
  }
  issues.throwIfAny("The top-up did not pass validation.");
}

const isTerminal = (t: MobileTopup): boolean =>
  TOPUP_TERMINAL.includes(t.status);

export class Mobile extends Resource {
  /** The plans available to your account, split into dynamic and fixed. */
  plans(signal?: AbortSignal): Promise<MobilePlans> {
    return this.getData<MobilePlans>("mobile/plans", undefined, signal);
  }

  /**
   * Send a top-up. The number and amount are checked first, and a reference is
   * generated when you do not pass one, so the returned `topupRef` is always set.
   */
  async send(
    input: MobileSendInput,
    signal?: AbortSignal,
  ): Promise<MobileSendResult> {
    validateSend(input);
    const body = { ...input, ref: input.ref ?? generateRef() };
    return this.postData<MobileSendResult>("mobile/send", body, signal);
  }

  /** Look a top-up up by your own reference. */
  checkByRef(ref: string, signal?: AbortSignal): Promise<MobileTopup> {
    return this.getData<MobileTopup>(
      `mobile/check-ref/${encodeURIComponent(ref)}`,
      undefined,
      signal,
    );
  }

  /** Look a top-up up by the id from `send`. */
  checkById(id: string, signal?: AbortSignal): Promise<MobileTopup> {
    return this.getData<MobileTopup>(
      `mobile/check-id/${encodeURIComponent(id)}`,
      undefined,
      signal,
    );
  }

  /**
   * Send a top-up and wait for it to settle, polling by reference. Resolves with
   * the final top-up once it is FULFILLED, REFUNDED, or UNKNOWN_ERROR. Defaults
   * to a check every 5 seconds for up to 5 minutes, which the docs recommend.
   */
  async sendAndWait(
    input: MobileSendInput,
    options: PollOptions = {},
  ): Promise<MobileTopup> {
    const { topupId } = await this.send(input, options.signal);
    return pollUntil(
      () => this.checkById(topupId, options.signal),
      isTerminal,
      { intervalMs: 5000, maxAttempts: 60, ...options },
    );
  }

  /**
   * List the offers available for a number. This drives the GETMENU plans: it
   * sends a GETMENU order with a small probe amount that the operator refunds
   * rather than charges, then reads the offers back off the refunded order. Each
   * offer carries the `plan_code` and `amount` you would pass to `send` to buy it.
   */
  async getOffers(
    operator: MobileOperator,
    MSSIDN: string,
    options: PollOptions = {},
  ): Promise<MobileOffer[]> {
    if (!isMobileNumber(MSSIDN)) {
      const issues = new Issues();
      issues.add("MSSIDN", "is not a valid mobile number");
      issues.throwIfAny();
    }
    // The amount is a refunded probe, not a charge. A small in-range value works
    // across operators; the GETMENU plans accept from 50 dinars up.
    const { topupId } = await this.send(
      { plan_code: `GETMENU_${operator}`, MSSIDN, amount: 50 },
      options.signal,
    );
    const topup = await pollUntil(
      () => this.checkById(topupId, options.signal),
      isTerminal,
      { intervalMs: 3000, maxAttempts: 20, ...options },
    );
    return topup.suggested_offers ?? [];
  }

  /** One page of your past top-ups, newest first. */
  list(params: MobileListParams = {}): Promise<Page<MobileTopup>> {
    return this.fetchPage<MobileTopup>("mobile/list", { ...params }, extractTopups);
  }

  /** Every past top-up across every page, as an async iterator. */
  paginate(params: MobileListParams = {}): AsyncGenerator<MobileTopup> {
    return this.iterate(this.list(params));
  }
}
