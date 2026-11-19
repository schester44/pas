import { workflowSubject } from "@pas/kernel";

const KEYS = {
  policyId: "policy",
  termId: "term",
  transactionId: "transaction",
  invoiceId: "invoice",
  mortgageeBillId: "mortgagee_bill",
  agencyId: "agency",
  quoteId: "quote",
  submissionId: "submission",
  obligationId: "obligation",
  filingId: "filing",
  inspectionId: "inspection",
  subjectivityId: "subjectivity",
} as const;

/** Tags a run with the aggregates its event payload names, so lifecycle changes can find it. */
export function subjectsFrom(payload: Record<string, unknown>): string[] {
  return Object.entries(KEYS).flatMap(([key, type]) => {
    const id = payload[key];

    return typeof id === "string" && id ? [workflowSubject(type, id)] : [];
  });
}
