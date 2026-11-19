import { type TenantContext, workflowSubject } from "@pas/kernel";

export type LifecycleChange =
  | { kind: "cancelled"; policyId: string; termId: string }
  | { kind: "rescinded"; policyId: string; termId: string };

export interface LiveRun {
  runId: string;
  workflowId: string;
  input: unknown;
  subjects: readonly string[];
}

export interface CleanupFacts {
  /** Invoices the cancellation left with nothing to collect (voided or settled by credit). */
  settledInvoiceIds: ReadonlySet<string>;
}

export interface Cleanup {
  runId: string;
  reason: string;
}

const idsOf = (run: LiveRun, type: string) =>
  run.subjects.filter((s) => s.startsWith(`${type}:`)).map((s) => s.slice(type.length + 1));

const inputId = (run: LiveRun, key: string) => {
  const value = (run.input as Record<string, unknown> | null)?.[key];

  return typeof value === "string" ? value : undefined;
};

const onTerm = (run: LiveRun, termId: string) =>
  run.subjects.includes(workflowSubject("term", termId)) || inputId(run, "termId") === termId;

type Rule = (run: LiveRun, change: LifecycleChange, facts: CleanupFacts) => string | null;

// Compliance runs never appear here: filings stay legally owed after a cancellation.
const RULES: Record<LifecycleChange["kind"], Record<string, Rule>> = {
  cancelled: {
    "policy.term": (run, change) =>
      onTerm(run, change.termId) ? "Policy cancelled before it took effect" : null,
    "billing.installment": (run, _change, facts) => {
      const invoiceId = inputId(run, "invoiceId");

      return invoiceId && facts.settledInvoiceIds.has(invoiceId)
        ? "Installment closed by the cancellation credit"
        : null;
    },
    "billing.mortgagee_bill": (run, _change, facts) =>
      idsOf(run, "invoice").some((id) => facts.settledInvoiceIds.has(id))
        ? "Lender invoice credited by the cancellation"
        : null,
    "underwriting.inspection": () => "Policy cancelled; inspection called off",
    "underwriting.subjectivity": () => "Policy cancelled; subjectivity waived",
  },
  rescinded: {
    "policy.cancellation": (run, change) =>
      onTerm(run, change.termId) ? "Cancellation rescinded" : null,
  },
};

/** Which live runs a lifecycle change makes pointless, and why. */
export function planCleanup(
  change: LifecycleChange,
  runs: readonly LiveRun[],
  facts: CleanupFacts,
): Cleanup[] {
  const rules = RULES[change.kind];

  return runs.flatMap((run) => {
    const reason = rules[run.workflowId]?.(run, change, facts) ?? null;

    return reason ? [{ runId: run.runId, reason }] : [];
  });
}

export interface CleanupDeps {
  liveRuns(ctx: TenantContext, subjects: readonly string[]): Promise<LiveRun[]>;
  cancelRun(ctx: TenantContext, runId: string, reason: string): Promise<void>;
  settledInvoiceIds(ctx: TenantContext, policyId: string): Promise<Set<string>>;
  closeConditions(
    ctx: TenantContext,
    input: { policyId: string; reason: string },
  ): Promise<{ subjectivityIds: string[]; inspectionIds: string[] }>;
}

/** Idempotent: cancelled runs aren't live any more, and closed conditions stay closed. */
export function makeLifecycleCleanup(deps: CleanupDeps) {
  return async function cleanUp(ctx: TenantContext, change: LifecycleChange) {
    const subjects = [
      workflowSubject("policy", change.policyId),
      workflowSubject("term", change.termId),
    ];

    let facts: CleanupFacts = { settledInvoiceIds: new Set() };

    if (change.kind === "cancelled") {
      const closed = await deps.closeConditions(ctx, {
        policyId: change.policyId,
        reason: "Policy cancelled",
      });

      subjects.push(
        ...closed.inspectionIds.map((id) => workflowSubject("inspection", id)),
        ...closed.subjectivityIds.map((id) => workflowSubject("subjectivity", id)),
      );

      facts = { settledInvoiceIds: await deps.settledInvoiceIds(ctx, change.policyId) };
    }

    const plan = planCleanup(change, await deps.liveRuns(ctx, subjects), facts);

    for (const { runId, reason } of plan) await deps.cancelRun(ctx, runId, reason);

    return plan;
  };
}
