import { describe, it, expect, vi } from "vitest";
import { pollUntil, PollTimeoutError } from "../src/poll";

const terminal = (s: { status: string }) =>
  s.status === "FULFILLED" || s.status === "REFUNDED";

describe("pollUntil", () => {
  it("returns at once when the first check is already settled", async () => {
    const fetchOnce = vi.fn(async () => ({ status: "FULFILLED" }));
    const result = await pollUntil(fetchOnce, terminal, { intervalMs: 0 });
    expect(result.status).toBe("FULFILLED");
    expect(fetchOnce).toHaveBeenCalledTimes(1);
  });

  it("checks again until a terminal status arrives", async () => {
    const statuses = ["PENDING", "HANDLING", "FULFILLED"];
    let i = 0;
    const fetchOnce = vi.fn(async () => ({ status: statuses[i++]! }));
    const result = await pollUntil(fetchOnce, terminal, { intervalMs: 0 });
    expect(result.status).toBe("FULFILLED");
    expect(fetchOnce).toHaveBeenCalledTimes(3);
  });

  it("throws PollTimeoutError with the last value after the budget runs out", async () => {
    const fetchOnce = vi.fn(async () => ({ status: "HANDLING" }));
    const promise = pollUntil(fetchOnce, terminal, {
      intervalMs: 0,
      maxAttempts: 3,
    });
    await expect(promise).rejects.toBeInstanceOf(PollTimeoutError);
    expect(fetchOnce).toHaveBeenCalledTimes(3);
    await promise.catch((error: PollTimeoutError) => {
      expect(error.last).toEqual({ status: "HANDLING" });
    });
  });

  it("rejects right away when the signal is already aborted", async () => {
    const fetchOnce = vi.fn(async () => ({ status: "HANDLING" }));
    const controller = new AbortController();
    controller.abort();
    await expect(
      pollUntil(fetchOnce, terminal, { signal: controller.signal }),
    ).rejects.toBeDefined();
    expect(fetchOnce).not.toHaveBeenCalled();
  });

  it("stops waiting the moment it is aborted mid-interval", async () => {
    const fetchOnce = vi.fn(async () => ({ status: "HANDLING" }));
    const controller = new AbortController();
    const promise = pollUntil(fetchOnce, terminal, {
      intervalMs: 10_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 5);
    await expect(promise).rejects.toBeDefined();
    expect(fetchOnce).toHaveBeenCalledTimes(1);
  });
});
