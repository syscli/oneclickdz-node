// Client-side checks that run before a request leaves, so a wrong phone number
// or an out-of-range amount fails immediately instead of spending a request and
// a slice of the rate limit. The patterns mirror what the API documents for each
// service. Each resource composes these primitives with an Issues collector and
// throws a ValidationError if anything is wrong.

import { ValidationError, type ValidationIssue } from "./errors";

/** Mobile MSISDN: Mobilis, Djezzy, or Ooredoo, ten digits starting 05, 06, or 07. */
export const MOBILE_NUMBER = /^0[567]\d{8}$/;
/** ADSL line number: nine digits starting with 0. */
export const ADSL_NUMBER = /^0\d{8}$/;
/** 4G number: the 213 country code followed by nine digits. */
export const FOURG_NUMBER = /^213\d{9}$/;

export function isMobileNumber(value: string): boolean {
  return MOBILE_NUMBER.test(value);
}

export function isAdslNumber(value: string): boolean {
  return ADSL_NUMBER.test(value);
}

export function isFourgNumber(value: string): boolean {
  return FOURG_NUMBER.test(value);
}

/** A whole number of dinars, at or above one. The API has no fractional amounts. */
export function isWholeAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

/**
 * Gathers field problems and turns them into one ValidationError. Using a
 * collector rather than throwing on the first issue means a caller sees every
 * problem with an input at once.
 */
export class Issues {
  private readonly list: ValidationIssue[] = [];

  /** Record a problem. The ref ties an issue to one order when checking a batch. */
  add(field: string, message: string, ref?: string): this {
    this.list.push(ref ? { field, message, ref } : { field, message });
    return this;
  }

  /** Record a problem only when the condition holds. */
  addIf(condition: boolean, field: string, message: string, ref?: string): this {
    if (condition) this.add(field, message, ref);
    return this;
  }

  get any(): boolean {
    return this.list.length > 0;
  }

  all(): ValidationIssue[] {
    return this.list;
  }

  /** Throw if anything was collected; otherwise do nothing. */
  throwIfAny(summary = "The request did not pass validation."): void {
    if (this.list.length > 0) {
      throw new ValidationError(summary, { issues: this.list });
    }
  }
}

/** A required string field that must be present and non-empty. */
export function requireText(
  issues: Issues,
  value: unknown,
  field: string,
  ref?: string,
): void {
  if (typeof value !== "string" || value.trim() === "") {
    issues.add(field, "is required", ref);
  }
}
