import {
  agencyAccountWorkflow,
  type AgencyStatements,
  installmentWorkflow,
  type InstallmentTimers,
  type MortgageeBilling,
  mortgageeBillWorkflow,
} from "@pas/billing";
import { nightlyBatchWorkflow } from "@pas/agency-downloads";
import { filingWorkflow, obligationWorkflow, type ObligationTimers } from "@pas/compliance";
import type { TenantContext } from "@pas/kernel";
import { policyCancellationWorkflow, policyTermWorkflow, type TermTimers } from "@pas/policy";
import { type QuoteTimers, quoteJourneyWorkflow } from "@pas/submissions";
import type { SandboxTimers, UpcomingTimer } from "@pas/tenants";
import {
  type InspectionTimers,
  inspectionWorkflow,
  type SubjectivityTimers,
  subjectivityWorkflow,
} from "@pas/underwriting";
import type { PostgresWorkflows, ScheduledTimer } from "@pas/workflows";

const POLL_MS = 200;
const QUIET_MS = 1_200;
const SETTLE_LIMIT_MS = 20_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type DescribeRun = (
  ctx: TenantContext,
  run: Pick<ScheduledTimer, "workflowId" | "stepId" | "input">,
) => Promise<Pick<UpcomingTimer, "label" | "reference">>;

type Describe = DescribeRun;

export interface RunDescriberDeps {
  terms: TermTimers;
  quotes: QuoteTimers;
  installments: InstallmentTimers;
  obligations: ObligationTimers;
  inspections: InspectionTimers;
  subjectivities: SubjectivityTimers;
  agencyStatements: AgencyStatements;
  mortgagee: MortgageeBilling;
}

/** Names a run or timer the way a person recognises it: what it waits for, and on which record. */
export function makeRunDescriber(deps: RunDescriberDeps): DescribeRun {
  const describers: Record<string, Describe> = {
    [agencyAccountWorkflow.id]: async (_ctx, timer) => {
      const step = timer.stepId.replace(/^wait-/, "");
      const input = timer.input as { cutoff: string };

      const label =
        {
          cutoff: "Account current cut-off",
          "past-due": "Agency statement past due",
          remind: "Agency statement reminder",
          suspend: "Agency bill suspension",
        }[step] ?? "Agency statement step";

      return { label, reference: `Cut-off ${input.cutoff}` };
    },
    [mortgageeBillWorkflow.id]: async (ctx, timer) => {
      const bill = await deps.mortgagee.describe(ctx, timer.input as { mortgageeBillId: string });

      const step = timer.stepId.replace(/^wait-/, "");

      const label = step.startsWith("remind")
        ? "Lender premium reminder"
        : step === "offer-direct"
          ? "Offer direct bill to the insured"
          : step === "nonpayment"
            ? "Mortgagee bill nonpayment"
            : "Mortgagee bill step";

      return { label, reference: bill ? `${bill.policyNumber} · ${bill.lender}` : null };
    },
    [nightlyBatchWorkflow.id]: async (_ctx, timer) => ({
      label: "Agency downloads batch",
      reference: `Batch for ${(timer.input as { runDate: string }).runDate}`,
    }),
    [policyTermWorkflow.id]: async (ctx, timer) => {
      const policy = await deps.terms.describe(ctx, timer.input as { termId: string });

      return { label: "Policy becomes effective", reference: policy?.number ?? null };
    },
    [policyCancellationWorkflow.id]: async (ctx, timer) => {
      const policy = await deps.terms.describe(ctx, timer.input as { termId: string });

      return { label: "Cancellation takes effect", reference: policy?.number ?? null };
    },
    [installmentWorkflow.id]: async (ctx, timer) => {
      const invoice = await deps.installments.describe(ctx, timer.input as { invoiceId: string });
      const step = timer.stepId.replace(/^wait-/, "");

      const label =
        {
          open: "Installment invoice opens",
          charge: "Installment due (autopay)",
          "past-due": "Installment past due",
          remind: "Payment reminder",
          delinquent: "Grace period ends",
        }[step] ?? (step.startsWith("retry") ? "Autopay retry" : "Installment step");

      return { label, reference: invoice ? `${invoice.policyNumber} · ${invoice.number}` : null };
    },
    [obligationWorkflow.id]: async (ctx, timer) => {
      const obligation = await deps.obligations.describe(
        ctx,
        timer.input as { obligationId: string },
      );

      const step = timer.stepId.replace(/^wait-/, "");

      const what =
        { remind: "reminder", overdue: "deadline", escalate: "escalation" }[step] ?? "timer";

      return {
        label: `${obligation?.title ?? "Obligation"} ${what}`,
        reference: obligation?.reference ?? null,
      };
    },
    [filingWorkflow.id]: async (ctx, timer) => {
      const obligation = await deps.obligations.describe(
        ctx,
        timer.input as { obligationId: string },
      );

      return { label: "Filing answer check", reference: obligation?.reference ?? null };
    },
    [inspectionWorkflow.id]: async (ctx, timer) => {
      const inspection = await deps.inspections.describe(
        ctx,
        timer.input as { inspectionId: string },
      );

      return {
        label: `${inspection?.label ?? "Inspection"} update`,
        reference: inspection?.reference ?? null,
      };
    },
    [subjectivityWorkflow.id]: async (ctx, timer) => {
      const subjectivity = await deps.subjectivities.describe(
        ctx,
        timer.input as { subjectivityId: string },
      );

      return {
        label: `${subjectivity?.title ?? "Subjectivity"} due`,
        reference: subjectivity?.reference ?? null,
      };
    },
    [quoteJourneyWorkflow.id]: async (ctx, timer) => {
      const quote = await deps.quotes.describe(ctx, timer.input as { quoteId: string });

      return { label: "Quote expires", reference: quote?.submissionNumber ?? null };
    },
  };

  return (ctx, timer) =>
    describers[timer.workflowId]?.(ctx, timer).catch(() => ({
      label: timer.workflowId,
      reference: null,
    })) ?? Promise.resolve({ label: timer.workflowId, reference: null });
}

/** Turns the workflow engine's timers into what a sandbox user recognises. */
export function makeSandboxTimers(
  deps: RunDescriberDeps & { workflows: PostgresWorkflows },
): SandboxTimers {
  const describe = makeRunDescriber(deps);

  return {
    async upcoming(ctx, options) {
      const timers = await deps.workflows.timers(ctx, options);

      return Promise.all(
        timers.map(async (timer) => ({
          runId: timer.runId,
          workflowId: timer.workflowId,
          stepId: timer.stepId,
          dueAt: timer.dueAt,
          ...(await describe(ctx, timer)),
        })),
      );
    },
    release: (ctx) => deps.workflows.retime(ctx),
    // Woken runs can emit events that start more runs, so wait for a quiet spell, not just zero.
    async settle(ctx) {
      const deadline = Date.now() + SETTLE_LIMIT_MS;
      let quietSince = Date.now();

      while (Date.now() < deadline) {
        await sleep(POLL_MS);

        if ((await deps.workflows.activeRuns(ctx)) > 0) quietSince = Date.now();
        else if (Date.now() - quietSince >= QUIET_MS) return;
      }
    },
    async outcome(ctx, runId) {
      const run = await deps.workflows.status(ctx, runId);
      const output = run.output as { status?: unknown } | null;

      return run.status === "completed" && typeof output?.status === "string"
        ? output.status
        : run.status;
    },
  };
}
