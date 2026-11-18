import { describe, expect, it } from "vitest";
import { timerPlan } from "./tenant-time";

const DAY = 86_400_000;
const wallNow = new Date("2026-11-18T12:00:00Z");
const effective = new Date("2026-12-01T05:01:00Z");

describe("timerPlan", () => {
  it("fires on the wall clock when the tenant has no offset", () => {
    expect(timerPlan(effective, 0, wallNow)).toEqual({ due: false, startAfter: effective });
  });

  it("moves the wall-clock fire time earlier as the tenant's offset grows", () => {
    const tenDays = timerPlan(effective, 10 * DAY, wallNow);

    expect(tenDays.due).toBe(false);
    expect(tenDays.startAfter.toISOString()).toBe("2026-11-21T05:01:00.000Z");

    expect(timerPlan(effective, 13 * DAY, wallNow).due).toBe(true);
  });
});
