// ADSL and 4G internet recharges. The flow matches mobile: validate the number,
// send, then poll. The difference is the payload: a settled order carries a
// `card_code`, the recharge code the customer keys in. That code comes back
// wrapped in a Secret so it stays out of logs until you call `reveal()`.

import { Resource, type Page } from "./base";
import type { Envelope, Pagination } from "../http";
import type { TopupStatus } from "../types";
import { TOPUP_TERMINAL } from "../types";
import { pollUntil, type PollOptions } from "../poll";
import { generateRef } from "../ref";
import {
  Issues,
  isAdslNumber,
  isFourgNumber,
  isWholeAmount,
} from "../validate";
import { Secret } from "../secret";

export type InternetType = "ADSL" | "4G";

export interface InternetProduct {
  /** Your wholesale cost. Strip this before showing products to end users. */
  cost: number;
  /** The card's face value in dinars. */
  value: number;
  available: boolean;
}

export interface InternetProducts {
  products: InternetProduct[];
  type: string;
}

export interface NumberCheck {
  /** The masked client identifier the API returns for a valid line. */
  ncli: string;
  type: string;
  /** The current offer, for ADSL lines. */
  offre?: string;
}

export interface InternetSendInput {
  type: InternetType;
  /** ADSL: nine digits starting 0. 4G: 213 followed by nine digits. */
  number: string;
  /** A face value from `products()`. */
  value: number;
  /** Your order reference. One is generated when omitted. */
  ref?: string;
}

export interface InternetSendResult {
  topupId: string;
  topupRef: string;
}

export interface InternetTopup {
  _id: string;
  ref?: string;
  status: TopupStatus;
  type: string;
  number: string;
  topup_amount: number;
  /** The recharge code, present once FULFILLED. Call `.reveal()` to read it. */
  card_code?: Secret<string>;
  num_trans?: string;
  date_traitement?: string;
  created_at: string;
}

export interface InternetListParams {
  page?: number;
  pageSize?: number;
  from?: string;
  to?: string;
}

interface RawInternetTopup {
  _id: string;
  ref?: string;
  status: TopupStatus;
  type: string;
  number: string;
  topup_amount: number;
  card_code?: string;
  num_trans?: string;
  date_traitement?: string;
  created_at: string;
}

/** Wrap the recharge code so it cannot be logged by accident. */
function toTopup(raw: RawInternetTopup): InternetTopup {
  const { card_code, ...rest } = raw;
  return card_code
    ? { ...rest, card_code: Secret.of(card_code) }
    : { ...rest };
}

/**
 * The internet list endpoint is the odd one out: items sit under `topups` and
 * pagination under `meta.pagination` with its own field names. Normalize both.
 */
function extractInternetTopups(env: Envelope<unknown>): {
  items: InternetTopup[];
  pagination: Pagination;
} {
  const data = (env.data ?? {}) as { topups?: RawInternetTopup[] };
  const page = (env.meta?.pagination ?? {}) as {
    currentPage?: number;
    page?: number;
    totalPages?: number;
    totalItems?: number;
    totalResults?: number;
  };
  const items = (data.topups ?? []).map(toTopup);
  return {
    items,
    pagination: {
      page: page.currentPage ?? page.page ?? 1,
      pageSize: items.length,
      totalPages: page.totalPages ?? 1,
      totalResults: page.totalItems ?? page.totalResults ?? items.length,
    },
  };
}

function validateSend(input: InternetSendInput): void {
  const issues = new Issues();
  if (input.type !== "ADSL" && input.type !== "4G") {
    issues.add("type", "must be ADSL or 4G");
  } else if (input.type === "ADSL" && !isAdslNumber(input.number)) {
    issues.add("number", "is not a valid ADSL number");
  } else if (input.type === "4G" && !isFourgNumber(input.number)) {
    issues.add("number", "is not a valid 4G number");
  }
  if (!isWholeAmount(input.value)) {
    issues.add("value", "must be a whole number of dinars");
  }
  issues.throwIfAny("The internet top-up did not pass validation.");
}

const isTerminal = (t: InternetTopup): boolean =>
  TOPUP_TERMINAL.includes(t.status);

export class Internet extends Resource {
  /** The cards on offer for a service type, with their cost and stock. */
  products(type: InternetType, signal?: AbortSignal): Promise<InternetProducts> {
    return this.getData<InternetProducts>("internet/products", { type }, signal);
  }

  /** Confirm a number is valid and active before sending to it. */
  checkNumber(
    type: InternetType,
    number: string,
    signal?: AbortSignal,
  ): Promise<NumberCheck> {
    return this.getData<NumberCheck>(
      "internet/check-number",
      { type, number },
      signal,
    );
  }

  /** Send a recharge. The number and value are checked first; a ref is filled in. */
  async send(
    input: InternetSendInput,
    signal?: AbortSignal,
  ): Promise<InternetSendResult> {
    validateSend(input);
    const body = { ...input, ref: input.ref ?? generateRef() };
    return this.postData<InternetSendResult>("internet/send", body, signal);
  }

  async checkByRef(ref: string, signal?: AbortSignal): Promise<InternetTopup> {
    const raw = await this.getData<RawInternetTopup>(
      `internet/check-ref/${encodeURIComponent(ref)}`,
      undefined,
      signal,
    );
    return toTopup(raw);
  }

  async checkById(id: string, signal?: AbortSignal): Promise<InternetTopup> {
    const raw = await this.getData<RawInternetTopup>(
      `internet/check-id/${encodeURIComponent(id)}`,
      undefined,
      signal,
    );
    return toTopup(raw);
  }

  /**
   * Send and wait for the recharge to settle. Resolves with the final order,
   * its `card_code` ready to reveal once FULFILLED. Note that a QUEUED order can
   * take up to 48 hours, longer than the default polling window.
   */
  async sendAndWait(
    input: InternetSendInput,
    options: PollOptions = {},
  ): Promise<InternetTopup> {
    const ref = input.ref ?? generateRef();
    await this.send({ ...input, ref }, options.signal);
    return pollUntil(() => this.checkByRef(ref, options.signal), isTerminal, {
      intervalMs: 5000,
      maxAttempts: 60,
      ...options,
    });
  }

  list(params: InternetListParams = {}): Promise<Page<InternetTopup>> {
    return this.fetchPage<InternetTopup>(
      "internet/list",
      { ...params },
      extractInternetTopups,
    );
  }

  paginate(params: InternetListParams = {}): AsyncGenerator<InternetTopup> {
    return this.iterate(this.list(params));
  }
}
