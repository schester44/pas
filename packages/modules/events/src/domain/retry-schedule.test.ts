import { describe, expect, it } from "vitest";
import { MAX_ATTEMPTS, retryDelay } from "./retry-schedule";

describe("retry schedule", () => {
  it("backs off over about a day, then stops", () => {
    const delays = Array.from({ length: MAX_ATTEMPTS }, (_, i) => retryDelay(i + 1));
    const minutes = delays.map((d) => d?.total("minutes") ?? null);

    expect(minutes).toEqual([1, 5, 30, 120, 300, 480, 480, null]);

    const total = minutes.reduce<number>((sum, m) => sum + (m ?? 0), 0);

    expect(total / 60).toBeGreaterThan(23);
    expect(total / 60).toBeLessThanOrEqual(24);
  });
});
