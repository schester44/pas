import { asId, jurisdiction, Money, sameClockForAll } from "@pas/kernel";
import { describe, expect, it } from "vitest";
import { canTransition, Referral } from "./referral";

const clock = sameClockForAll({
  now: () => Temporal.Instant.from("2028-01-10T15:00:00Z"),
  today: () => Temporal.PlainDate.from("2028-01-10"),
}).forTenant(asId("t1"));

const usd = (amount: string) => Money.of(amount, "USD");
const riley = { id: "riley", name: "Riley Underwriter" };
const morgan = { id: "morgan", name: "Morgan Lee" };

const referral = (requiredLevel = 1) =>
  Referral.open(
    {
      tenantId: asId("t1"),
      quoteId: "q1",
      submissionId: "s1",
      submissionNumber: "SUB-1",
      productId: "p1",
      productName: "Homeowners",
      jurisdiction: jurisdiction("US", "US-IL"),
      insuredName: "Jordan Avery",
      producer: { ...morgan, agencyId: null },
      quote: {
        revision: 1,
        reasons: [{ reasonCode: "COAST", message: "Near the coast", outcome: "refer" }],
        writtenPremium: usd("2400"),
        total: usd("2600"),
        insuredValue: usd("400000"),
        dueAt: Temporal.Instant.from("2028-01-11T15:00:00Z"),
      },
      requiredLevel,
    },
    clock,
  );

describe("referral transitions", () => {
  it("goes to the producer for information and back to the queue on their reply", () => {
    const r = referral();

    r.requestInfo("When was the roof replaced?", riley, clock);
    expect(r.status).toBe("info_requested");

    r.reply("In 2019, invoice attached.", morgan, clock);
    expect(r.status).toBe("open");

    expect(r.pullEvents().map((e) => e.type)).toEqual([
      "underwriting.referral_created",
      "underwriting.info_requested",
      "underwriting.info_provided",
    ]);
  });

  it("returns an escalated referral to the escalated queue after the producer answers", () => {
    const r = referral();

    r.escalate({ level: 2, problems: ["Premium over limit"], by: riley }, clock);
    r.requestInfo("Send the wind mitigation form", riley, clock);
    r.reply("Attached", morgan, clock);

    expect(r.status).toBe("escalated");
    expect(r.toSnapshot().requiredLevel).toBe(2);
  });

  it("refuses an approval below the required level and anything after a decision", () => {
    const r = referral(2);

    expect(() => r.approve({ by: riley, level: 1, note: null, changes: {} }, clock)).toThrow(
      /higher underwriting authority/,
    );

    r.approve({ by: riley, level: 2, note: null, changes: {} }, clock);
    expect(r.status).toBe("approved");
    expect(() => r.decline({ by: riley, note: null, changes: {} }, clock)).toThrow();
    expect(canTransition("declined", "open")).toBe(false);
  });
});
