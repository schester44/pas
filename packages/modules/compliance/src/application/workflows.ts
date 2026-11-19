import { invalid, workflowRef } from "@pas/kernel";

export interface ObligationWorkflowInput {
  obligationId: string;
}

export interface FilingWorkflowInput {
  obligationId: string;
  filingId: string;
}

const text = (value: unknown, name: string) => {
  if (typeof value !== "string" || value.length === 0) throw invalid(`Missing ${name}`);

  return value;
};

/** One obligation's due-date timers: reminder, overdue, escalation (PLAN §17.1). */
export const obligationWorkflow = workflowRef<ObligationWorkflowInput>("compliance.obligation", {
  parse: (value) => ({
    obligationId: text((value as Partial<ObligationWorkflowInput>)?.obligationId, "obligationId"),
  }),
});

/** Waits for an API channel's answer to one filing. */
export const filingWorkflow = workflowRef<FilingWorkflowInput>("compliance.filing", {
  parse: (value) => {
    const v = (value ?? {}) as Partial<FilingWorkflowInput>;

    return {
      obligationId: text(v.obligationId, "obligationId"),
      filingId: text(v.filingId, "filingId"),
    };
  },
});
