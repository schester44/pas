import { describe, expect, it } from "vitest";
import { type LiveRun, planCleanup } from "./lifecycle-cleanup";

const change = { policyId: "p1", termId: "t1" };

const run = (runId: string, workflowId: string, input: object, subjects: string[] = []) =>
  ({ runId, workflowId, input, subjects }) satisfies LiveRun;

const runs = [
  run("term", "policy.term", { termId: "t1" }, ["policy:p1", "term:t1"]),
  run("other-term", "policy.term", { termId: "t2" }, ["term:t2"]),
  run("cancellation", "policy.cancellation", { termId: "t1", transactionId: "x" }, ["term:t1"]),
  run("void-installment", "billing.installment", { invoiceId: "i2" }, ["invoice:i2"]),
  run("owed-installment", "billing.installment", { invoiceId: "i3" }, ["invoice:i3"]),
  run("lender", "billing.mortgagee_bill", { mortgageeBillId: "m1" }, ["invoice:i1"]),
  run("inspection", "underwriting.inspection", { inspectionId: "n1" }),
  run("subjectivity", "underwriting.subjectivity", { subjectivityId: "s1" }),
  run("obligation", "compliance.obligation", { obligationId: "o1" }, ["policy:p1"]),
  run("filing", "compliance.filing", { obligationId: "o1", filingId: "f1" }, ["policy:p1"]),
];

const facts = { settledInvoiceIds: new Set(["i1", "i2"]) };
const ids = (plan: { runId: string }[]) => plan.map((c) => c.runId).toSorted();

describe("planCleanup", () => {
  it("cancels what a cancellation makes pointless and keeps compliance running", () => {
    const plan = planCleanup({ kind: "cancelled", ...change }, runs, facts);

    expect(ids(plan)).toEqual(
      ["inspection", "lender", "subjectivity", "term", "void-installment"].toSorted(),
    );

    expect(plan.every((c) => c.reason.length > 0)).toBe(true);
  });

  it("cancels the pending term timer on a flat cancellation before the effective date", () => {
    const plan = planCleanup({ kind: "cancelled", ...change }, [runs[0]!], {
      settledInvoiceIds: new Set(),
    });

    expect(plan).toEqual([{ runId: "term", reason: "Policy cancelled before it took effect" }]);
  });

  it("only cancels the term's cancellation timer when a cancellation is rescinded", () => {
    const plan = planCleanup({ kind: "rescinded", ...change }, runs, facts);

    expect(plan).toEqual([{ runId: "cancellation", reason: "Cancellation rescinded" }]);
  });
});
