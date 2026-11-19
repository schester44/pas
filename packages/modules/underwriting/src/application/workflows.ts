import { invalid, workflowRef } from "@pas/kernel";

const uuid = (value: unknown, name: string) => {
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value))
    throw invalid(`Missing ${name}`);

  return value;
};

/** Orders one inspection and follows the vendor until the report is in (PLAN §11). */
export const inspectionWorkflow = workflowRef<{ inspectionId: string }>("underwriting.inspection", {
  parse: (value) => ({
    inspectionId: uuid((value as { inspectionId?: unknown } | null)?.inspectionId, "inspectionId"),
  }),
});

/** Waits out a post-bind subjectivity's due date and raises it if it's still open. */
export const subjectivityWorkflow = workflowRef<{ subjectivityId: string }>(
  "underwriting.subjectivity",
  {
    parse: (value) => ({
      subjectivityId: uuid(
        (value as { subjectivityId?: unknown } | null)?.subjectivityId,
        "subjectivityId",
      ),
    }),
  },
);
