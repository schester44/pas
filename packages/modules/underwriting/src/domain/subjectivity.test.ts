import { asId, sameClockForAll } from "@pas/kernel";
import { describe, expect, it } from "vitest";
import { dueDateOf, isOverdue, Subjectivity } from "./subjectivity";

const day = (iso: string) => Temporal.PlainDate.from(iso);

const clock = sameClockForAll({
  now: () => Temporal.Instant.from("2028-02-01T15:00:00Z"),
  today: () => day("2028-02-01"),
}).forTenant(asId("t1"));

const uw = { id: "u1", name: "Riley Underwriter" };

const postBind = () =>
  Subjectivity.create(
    {
      tenantId: asId("t1"),
      quoteId: "q1",
      submissionId: "s1",
      submissionNumber: "SUB-1",
      policyId: null,
      policyNumber: null,
      referralId: null,
      inspectionId: null,
      code: "WIND_MIT",
      title: "Wind mitigation affidavit",
      description: null,
      timing: "post_bind",
      dueDays: 30,
      owner: "producer",
      source: "underwriter",
      consequence: "Consider cancellation",
    },
    uw,
    clock,
  );

describe("subjectivity due dates", () => {
  it("falls due the given days after binding, and pre-bind ones have no date", () => {
    expect(dueDateOf("post_bind", day("2028-02-01"), 30)?.toString()).toBe("2028-03-02");
    expect(dueDateOf("pre_bind", day("2028-02-01"), 30)).toBeNull();
  });

  it("is overdue only after the due date and only while nothing was received", () => {
    const due = day("2028-03-02");

    expect(isOverdue({ status: "open", dueDate: due }, day("2028-03-02"))).toBe(false);
    expect(isOverdue({ status: "open", dueDate: due }, day("2028-03-03"))).toBe(true);
    expect(isOverdue({ status: "received", dueDate: due }, day("2028-03-03"))).toBe(false);
    expect(isOverdue({ status: "open", dueDate: null }, day("2030-01-01"))).toBe(false);
  });

  it("raises the overdue consequence once, after activation on the bound policy", () => {
    const s = postBind();

    s.activate({ id: "pol1", number: "HO-1" }, day("2028-02-01"), clock);
    s.pullEvents();

    expect(s.markOverdue(day("2028-03-03"), clock)).toBe(true);
    expect(s.markOverdue(day("2028-03-04"), clock)).toBe(false);

    expect(s.pullEvents()).toMatchObject([
      {
        type: "underwriting.subjectivity_overdue",
        payload: { consequence: "Consider cancellation" },
      },
    ]);
  });
});
