import { describe, expect, it } from "vitest";
import type { ScheduleEntry } from "./model";
import { buildPacket } from "./schedule";

const entry = (
  id: string,
  order: number,
  attachTo: ScheduleEntry["attachTo"],
  includeWhen?: string,
): ScheduleEntry => ({
  id,
  document: { kind: "template", key: id },
  attachTo,
  order,
  ...(includeWhen && { includeWhen }),
});

const schedule: ScheduleEntry[] = [
  entry("amendatory", 30, ["new_business", "renewal"], 'jurisdiction == "US-IL"'),
  entry("declarations", 10, ["new_business", "renewal", "endorsement"]),
  entry("water_backup", 20, ["new_business"], '"water_backup" in coverages'),
  entry("old_homes", 25, ["new_business"], "risk.yearBuilt < 1950"),
  entry("cancellation_notice", 10, ["cancellation"]),
  entry("broken", 40, ["new_business"], "risk.yearBuilt <"),
];

const context = {
  jurisdiction: { country: "US", subdivision: "US-IL" },
  transaction: "new_business" as const,
  coverages: ["dwelling", "water_backup"],
  risk: { yearBuilt: 1998 },
};

const ids = (packet: ReturnType<typeof buildPacket>) => packet.entries.map((e) => e.id);

describe("buildPacket", () => {
  it("includes entries for the transaction whose conditions hold, ordered", () => {
    const packet = buildPacket(schedule, context);

    expect(ids(packet)).toEqual(["declarations", "water_backup", "amendatory"]);
    expect(packet.errors.map((e) => e.entry)).toEqual(["broken"]);
  });

  it("drops state wording and coverage forms when they don't apply", () => {
    const packet = buildPacket(schedule, {
      ...context,
      jurisdiction: { country: "US", subdivision: "US-WI" },
      coverages: ["dwelling"],
      risk: { yearBuilt: 1931 },
    });

    expect(ids(packet)).toEqual(["declarations", "old_homes"]);
  });

  it("selects by transaction and keeps one copy of a document", () => {
    const duplicate = { ...entry("declarations", 5, ["cancellation"]), id: "dup" };

    const packet = buildPacket([...schedule, duplicate], {
      ...context,
      transaction: "cancellation",
    });

    expect(packet.entries.map((e) => e.id)).toEqual(["dup", "cancellation_notice"]);
  });
});
