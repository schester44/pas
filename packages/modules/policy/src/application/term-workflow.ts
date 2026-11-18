import { invalid, workflowRef } from "@pas/kernel";

export interface PolicyTermWorkflowInput {
  termId: string;
}

/** Flips a bound term from pending_effective to in_force on its effective date (PLAN §7.3). */
export const policyTermWorkflow = workflowRef<PolicyTermWorkflowInput>("policy.term", {
  parse(value) {
    const termId = (value as Partial<PolicyTermWorkflowInput> | null)?.termId;

    if (typeof termId !== "string" || termId.length === 0) {
      throw invalid("policy.term needs a termId");
    }

    return { termId };
  },
});
