import { describe, expect, it } from "vitest";

import { mapWithConcurrency } from "./concurrency";

describe("mapWithConcurrency", () => {
  it("preserves the order of results", async () => {
    // Earlier items resolve later — order must still follow the input
    const delays = [30, 1, 15, 5];
    const results = await mapWithConcurrency(delays, 2, async (delay) => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return delay;
    });
    expect(results).toEqual(delays);
  });

  it("never runs more than `limit` tasks at once", async () => {
    let running = 0;
    let peak = 0;
    await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
    });
    expect(peak).toBe(3);
  });

  it("handles an empty list", async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });
});
