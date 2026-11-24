import {
  type ClockProvider,
  type Jurisdiction,
  jurisdictionTimeZone,
  Money,
  type TenantContext,
} from "@pas/kernel";
import type { InvoiceDto } from "@pas/billing";
import type { ListPolicies, PolicyScope, PolicySummaryDto } from "@pas/policy";
import type { ListSubmissions, SubmissionScope, SubmissionSummaryDto } from "@pas/submissions";
import type { ListProducerActions } from "@pas/underwriting";

type MoneyDto = { amount: string; currency: string };

export type ActionItemKind =
  | "question"
  | "condition"
  | "ready_to_bind"
  | "quote_expiring"
  | "past_due"
  | "cancellation"
  | "term_expiring";

export interface ActionItem {
  id: string;
  kind: ActionItemKind;
  subject: { kind: "submission" | "policy"; id: string };
  insuredName: string | null;
  reference: string;
  productName: string;
  dueOn: string | null;
  overdue: boolean;
  detail: string | null;
  amount: MoneyDto | null;
}

/** Look-ahead windows for the agent's to-do list; product lifecycle config takes over once renewals exist. */
const QUOTE_EXPIRY_DAYS = 7;
const TERM_EXPIRY_DAYS = 60;
const LIMIT = 500;

const WITHDRAWN = "withdrawn";

/** Everything in the caller's book that's waiting on them, soonest first. */
export function makeActionItems(deps: {
  submissions: ListSubmissions;
  policies: ListPolicies;
  invoices: (ctx: TenantContext, policyIds: readonly string[]) => Promise<InvoiceDto[]>;
  underwriting: ListProducerActions;
  clocks: ClockProvider;
}) {
  return async function actionItems(
    ctx: TenantContext,
    scope: PolicyScope & SubmissionScope,
  ): Promise<ActionItem[]> {
    const clock = deps.clocks.forTenant(ctx.tenantId);
    const today = (j: Jurisdiction) => clock.today(jurisdictionTimeZone(j));

    const [submissions, policies] = await Promise.all([
      deps.submissions(ctx, scope, { limit: LIMIT }),
      deps.policies(ctx, scope, { limit: LIMIT }),
    ]);

    const open = submissions.filter((s) => s.status !== WITHDRAWN && s.quote?.status !== "bound");
    const active = policies.filter((p) => p.status !== "cancelled" && p.status !== "expired");

    const [underwriting, invoices] = await Promise.all([
      deps.underwriting(ctx, { submissionIds: submissions.map((s) => s.id) }),
      deps.invoices(
        ctx,
        active.map((p) => p.id),
      ),
    ]);

    const submissionById = new Map(submissions.map((s) => [s.id, s]));
    const policyById = new Map(policies.map((p) => [p.id, p]));

    const fromSubmission = (
      s: SubmissionSummaryDto,
      item: Pick<ActionItem, "id" | "kind" | "dueOn" | "overdue"> & Partial<ActionItem>,
    ): ActionItem => ({
      subject: { kind: "submission", id: s.id },
      insuredName: s.insuredName,
      reference: s.quote?.policyNumber ?? s.number,
      productName: s.productName,
      detail: null,
      amount: null,
      ...item,
    });

    const fromPolicy = (
      p: PolicySummaryDto,
      item: Pick<ActionItem, "id" | "kind" | "dueOn" | "overdue"> & Partial<ActionItem>,
    ): ActionItem => ({
      subject: { kind: "policy", id: p.id },
      insuredName: p.insuredName,
      reference: p.number,
      productName: p.productName,
      detail: null,
      amount: null,
      ...item,
    });

    const items: ActionItem[] = [];

    for (const q of underwriting.questions) {
      const s = submissionById.get(q.submissionId);

      if (s && s.status !== WITHDRAWN) {
        items.push(
          fromSubmission(s, {
            id: `question:${q.referralId}`,
            kind: "question",
            dueOn: null,
            overdue: false,
          }),
        );
      }
    }

    for (const c of underwriting.conditions) {
      const p = c.policyId ? policyById.get(c.policyId) : undefined;
      const s = submissionById.get(c.submissionId);
      const jurisdiction = p?.jurisdiction ?? s?.jurisdiction;

      if (!jurisdiction || (!p && (!s || s.status === WITHDRAWN))) continue;

      const overdue =
        c.dueDate !== null &&
        Temporal.PlainDate.compare(today(jurisdiction), Temporal.PlainDate.from(c.dueDate)) > 0;

      const item = {
        id: `condition:${c.id}`,
        kind: "condition" as const,
        dueOn: c.dueDate,
        overdue,
        detail: c.title,
      };

      items.push(p ? fromPolicy(p, item) : fromSubmission(s!, item));
    }

    const now = clock.now();

    for (const s of open) {
      if (!s.quote || s.quote.status !== "quoted") continue;

      const expiresAt = Temporal.Instant.from(s.quote.expiresAt);
      const expiresOn = expiresAt.toZonedDateTimeISO(jurisdictionTimeZone(s.jurisdiction));
      const daysLeft = now.until(expiresAt).total("days");

      if (daysLeft < 0) continue;

      if (s.quote.approved || daysLeft <= QUOTE_EXPIRY_DAYS) {
        items.push(
          fromSubmission(s, {
            id: `quote:${s.id}`,
            kind: s.quote.approved ? "ready_to_bind" : "quote_expiring",
            dueOn: expiresOn.toPlainDate().toString(),
            overdue: false,
            amount: s.quote.total,
          }),
        );
      }
    }

    const pastDue = new Map<string, { since: string; balance: Money }>();

    for (const invoice of invoices) {
      if (invoice.status !== "past_due") continue;

      const balance = Money.of(invoice.balance.amount, invoice.balance.currency);
      const seen = pastDue.get(invoice.policyId);

      pastDue.set(invoice.policyId, {
        since: seen && seen.since < invoice.dueOn ? seen.since : invoice.dueOn,
        balance: seen ? seen.balance.plus(balance) : balance,
      });
    }

    for (const p of active) {
      const due = pastDue.get(p.id);

      if (p.cancellation?.status === "pending") {
        items.push(
          fromPolicy(p, {
            id: `cancellation:${p.cancellation.transactionId}`,
            kind: "cancellation",
            dueOn: p.cancellation.effectiveDate,
            overdue: false,
            detail: p.cancellation.reasonLabel,
            amount: due?.balance.toJSON() ?? null,
          }),
        );

        continue;
      }

      if (due) {
        items.push(
          fromPolicy(p, {
            id: `past_due:${p.id}`,
            kind: "past_due",
            dueOn: due.since,
            overdue: true,
            amount: due.balance.toJSON(),
          }),
        );
      }

      const daysLeft = today(p.jurisdiction)
        .until(Temporal.PlainDate.from(p.expirationDate))
        .total({ unit: "days" });

      if (p.status === "in_force" && daysLeft >= 0 && daysLeft <= TERM_EXPIRY_DAYS) {
        items.push(
          fromPolicy(p, {
            id: `term_expiring:${p.id}:${p.expirationDate}`,
            kind: "term_expiring",
            dueOn: p.expirationDate,
            overdue: false,
            amount: p.annualPremium,
          }),
        );
      }
    }

    return items.toSorted(soonestFirst);
  };
}

export type ActionItems = ReturnType<typeof makeActionItems>;

/** Overdue work, then undated asks (an underwriter's question), then by due date. */
function soonestFirst(a: ActionItem, b: ActionItem): number {
  if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;

  if (a.dueOn === b.dueOn) return 0;

  if (a.dueOn === null) return -1;

  if (b.dueOn === null) return 1;

  return a.dueOn.localeCompare(b.dueOn);
}
