// Navio, the hosted payment gateway (OCPay in the API path). You create a
// payment link, send the customer to its URL, and poll the reference until the
// payment is confirmed or fails. A link expires twenty minutes after creation if
// no payment is started, which is also the default polling window here.

import { Resource } from "./base";
import type { PaymentStatus } from "../types";
import { PAYMENT_TERMINAL } from "../types";
import { pollUntil, type PollOptions } from "../poll";
import { Issues, isWholeAmount, requireText } from "../validate";

/** Who pays the gateway fee. NO_FEE is the default. */
export type FeeMode = "NO_FEE" | "SPLIT_FEE" | "CUSTOMER_FEE";

export const MIN_PAYMENT_AMOUNT = 500;
export const MAX_PAYMENT_AMOUNT = 500_000;

export interface PaymentProductInfo {
  /** What the customer is paying for. One to two hundred characters. */
  title: string;
  /** Optional details, up to a thousand characters. Markdown is allowed. */
  description?: string;
  /** Amount in dinars: a whole number from 500 to 500000. */
  amount: number;
}

export interface CreateLinkInput {
  productInfo: PaymentProductInfo;
  feeMode?: FeeMode;
  /** Shown to the customer after a successful payment, up to 500 characters. */
  successMessage?: string;
  /** Where to send the customer after payment. Must be http or https. */
  redirectUrl?: string;
}

export interface PaymentLink {
  uid: string;
  ref: string;
  isSandbox: boolean;
  productInfo: PaymentProductInfo;
  feeMode: FeeMode;
  successMessage?: string;
  redirectUrl?: string;
  time: string;
}

export interface CreateLinkResult {
  paymentLink: PaymentLink;
  /** The URL to send the customer to. */
  paymentUrl: string;
  /** The reference to poll with `checkPayment`. */
  paymentRef: string;
}

export interface PaymentTransactionDetails {
  amount: number;
  currency: string;
  isSandbox: boolean;
  /** Set once a payment has been started; absent while still PENDING. */
  createdDate?: string;
}

export interface PaymentCheck {
  status: PaymentStatus;
  message: string;
  paymentRef: string;
  transactionDetails: PaymentTransactionDetails;
}

function validateCreateLink(input: CreateLinkInput): void {
  const issues = new Issues();
  const info = input.productInfo ?? ({} as PaymentProductInfo);

  requireText(issues, info.title, "productInfo.title");
  if (typeof info.title === "string" && info.title.length > 200) {
    issues.add("productInfo.title", "must be at most 200 characters");
  }
  if (!isWholeAmount(info.amount)) {
    issues.add("productInfo.amount", "must be a whole number of dinars");
  } else if (
    info.amount < MIN_PAYMENT_AMOUNT ||
    info.amount > MAX_PAYMENT_AMOUNT
  ) {
    issues.add(
      "productInfo.amount",
      `must be between ${MIN_PAYMENT_AMOUNT} and ${MAX_PAYMENT_AMOUNT}`,
    );
  }
  if (info.description !== undefined && info.description.length > 1000) {
    issues.add("productInfo.description", "must be at most 1000 characters");
  }
  if (input.successMessage !== undefined && input.successMessage.length > 500) {
    issues.add("successMessage", "must be at most 500 characters");
  }
  if (
    input.feeMode !== undefined &&
    input.feeMode !== "NO_FEE" &&
    input.feeMode !== "SPLIT_FEE" &&
    input.feeMode !== "CUSTOMER_FEE"
  ) {
    issues.add("feeMode", "must be NO_FEE, SPLIT_FEE, or CUSTOMER_FEE");
  }
  if (input.redirectUrl !== undefined && !/^https?:\/\//.test(input.redirectUrl)) {
    issues.add("redirectUrl", "must start with http:// or https://");
  }
  issues.throwIfAny("The payment link did not pass validation.");
}

const isTerminal = (p: PaymentCheck): boolean =>
  PAYMENT_TERMINAL.includes(p.status);

export class Payments extends Resource {
  /** Create a payment link. Returns the URL to send the customer to. */
  async createLink(
    input: CreateLinkInput,
    signal?: AbortSignal,
  ): Promise<CreateLinkResult> {
    validateCreateLink(input);
    return this.postData<CreateLinkResult>("ocpay/createLink", input, signal);
  }

  /** Check a payment's status by its reference. */
  checkPayment(ref: string, signal?: AbortSignal): Promise<PaymentCheck> {
    return this.getData<PaymentCheck>(
      `ocpay/checkPayment/${encodeURIComponent(ref)}`,
      undefined,
      signal,
    );
  }

  /**
   * Poll a payment until it is CONFIRMED or FAILED. The default window is twenty
   * minutes, matching how long an unpaid link stays open; a payment that is
   * never started times out with a PollTimeoutError. Pass a signal to stop early.
   */
  waitForPayment(ref: string, options: PollOptions = {}): Promise<PaymentCheck> {
    return pollUntil(
      () => this.checkPayment(ref, options.signal),
      isTerminal,
      { intervalMs: 5000, maxAttempts: 240, ...options },
    );
  }
}
