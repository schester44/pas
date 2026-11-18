import { defineWorkflow, workflowRef } from "@pas/kernel";
import type { Logger } from "@pas/observability";
import { z } from "zod";

export const approvalDemoWorkflow = workflowRef(
  "demo.approval",
  z.object({ subject: z.string().min(1) }),
);

const approvalSchema = z.object({ approvedBy: z.string() });

export function makeApprovalDemoWorkflow(logger: Logger) {
  return defineWorkflow(approvalDemoWorkflow, async ({ input, runId, step }) => {
    await step.run("requested", async () => {
      logger.info({ runId, subject: input.subject }, "approval requested");

      return { requested: true };
    });

    const approval = await step.waitFor("approved", { timeout: "1 day", schema: approvalSchema });

    return step.run("finished", async () => {
      logger.info({ runId, approval }, approval ? "approval received" : "approval timed out");

      return { approved: approval !== undefined, approvedBy: approval?.approvedBy ?? null };
    });
  });
}
