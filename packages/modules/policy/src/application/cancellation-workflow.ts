import { invalid, workflowRef } from "@pas/kernel";

export interface PolicyCancellationWorkflowInput {
  termId: string;
  transactionId: string;
}

/** Waits for a scheduled cancellation's effective date, then issues it (PLAN §7.3). */
export const policyCancellationWorkflow = workflowRef<PolicyCancellationWorkflowInput>(
  "policy.cancellation",
  {
    parse(value) {
      const input = (value ?? {}) as Partial<PolicyCancellationWorkflowInput>;

      if (typeof input.termId !== "string" || typeof input.transactionId !== "string") {
        throw invalid("policy.cancellation needs a termId and transactionId");
      }

      return { termId: input.termId, transactionId: input.transactionId };
    },
  },
);
