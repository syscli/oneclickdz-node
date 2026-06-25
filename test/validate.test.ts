import { describe, it, expect } from "vitest";
import {
  Issues,
  requireText,
  isMobileNumber,
  isAdslNumber,
  isFourgNumber,
  isWholeAmount,
} from "../src/validate";
import { ValidationError } from "../src/errors";

describe("number formats", () => {
  it("accepts Mobilis, Djezzy, and Ooredoo mobile numbers", () => {
    expect(isMobileNumber("0778037340")).toBe(true);
    expect(isMobileNumber("0661234567")).toBe(true);
    expect(isMobileNumber("0550000000")).toBe(true);
  });

  it("rejects malformed mobile numbers", () => {
    expect(isMobileNumber("0478037340")).toBe(false); // 04 is not mobile
    expect(isMobileNumber("077803734")).toBe(false); // too short
    expect(isMobileNumber("213778037340")).toBe(false);
  });

  it("checks ADSL and 4G formats", () => {
    expect(isAdslNumber("033123456")).toBe(true);
    expect(isAdslNumber("0331234567")).toBe(false);
    expect(isFourgNumber("213778037340")).toBe(true);
    expect(isFourgNumber("0778037340")).toBe(false);
  });

  it("only accepts whole dinar amounts of one or more", () => {
    expect(isWholeAmount(500)).toBe(true);
    expect(isWholeAmount(0)).toBe(false);
    expect(isWholeAmount(99.5)).toBe(false);
    expect(isWholeAmount("500")).toBe(false);
  });
});

describe("Issues", () => {
  it("collects every problem and throws one error", () => {
    const issues = new Issues();
    requireText(issues, "", "MSSIDN", "order-1");
    issues.addIf(true, "amount", "is out of range", "order-1");
    issues.addIf(false, "ignored", "never added");

    expect(issues.any).toBe(true);
    expect(issues.all()).toHaveLength(2);

    try {
      issues.throwIfAny();
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const issueList = (error as ValidationError).issues;
      expect(issueList.map((i) => i.field)).toEqual(["MSSIDN", "amount"]);
      expect(issueList[0]?.ref).toBe("order-1");
    }
  });

  it("does nothing when there is nothing wrong", () => {
    const issues = new Issues();
    requireText(issues, "PREPAID_DJEZZY", "plan_code");
    expect(issues.any).toBe(false);
    expect(() => issues.throwIfAny()).not.toThrow();
  });
});
