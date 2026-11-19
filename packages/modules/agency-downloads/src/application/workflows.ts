import { invalid, workflowRef } from "@pas/kernel";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const isDate = (v: unknown): v is string => typeof v === "string" && DATE.test(v);

export interface NightlyBatchWorkflowInput {
  runDate: string;
}

/** One night's agency download batch: waits for the batch time, sends, then books the next night. */
export const nightlyBatchWorkflow = workflowRef<NightlyBatchWorkflowInput>(
  "agency_downloads.nightly",
  {
    parse(value) {
      const input = (value ?? {}) as Partial<NightlyBatchWorkflowInput>;

      if (!isDate(input.runDate)) throw invalid("agency_downloads.nightly needs a runDate");

      return { runDate: input.runDate };
    },
  },
);
