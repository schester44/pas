import { formatMoney, newId, type TenantContext } from "@pas/kernel";
import { NO_NOTICE } from "../domain/notice";
import type { PolicyScope } from "../domain/scope";
import type { BillingStatus } from "../ports/notice-delivery";
import {
  type CancellationDeps,
  commitCancellation,
  dispatchNotice,
  renderNotice,
} from "./commit-cancellation";
import { billIssued, loadPolicy, priceCancellation, today } from "./pricing";

const TENANT: PolicyScope = { kind: "tenant" };
const NONPAYMENT = "nonpayment";

type Deps = CancellationDeps & { billing: BillingStatus };

/**
 * A delinquent account starts nonpayment (PLAN §13, §17.3): a notice of intent to cancel, sent by
 * email and by mail when the notice rules require it (none where no rule applies), and the
 * cancellation scheduled for the earliest valid date. Paying the past-due amount before then cures it.
 */
export function makeStartNonpayment(deps: Deps) {
  return async function startNonpayment(
    ctx: TenantContext,
    input: { policyId: string },
  ): Promise<
    { status: "scheduled"; effectiveDate: string } | { status: "skipped"; reason: string }
  > {
    const policy = await loadPolicy(deps, ctx, TENANT, input.policyId);
    const term = policy.currentTerm;

    if (term.status !== "in_force" && term.status !== "pending_effective") {
      return { status: "skipped", reason: `the term is ${term.status.replace("_", " ")}` };
    }

    if (policy.openTransaction(term.id)) return { status: "skipped", reason: "a change is open" };

    const pastDue = await deps.billing.pastDue(ctx, input.policyId);

    if (!pastDue || Number(pastDue.amount) <= 0)
      return { status: "skipped", reason: "nothing past due" };

    const pricing = await priceCancellation(deps, ctx, policy, {
      reason: NONPAYMENT,
      note: `${formatMoney(pastDue)} past due`,
    });

    const transaction = await commitCancellation(deps, ctx, TENANT, {
      policyId: input.policyId,
      pricing,
      actor: { type: "system", name: "Nonpayment" },
      notice: { kind: "intent", amountDue: pastDue },
    });

    return { status: "scheduled", effectiveDate: transaction.effectiveDate };
  };
}

export type StartNonpayment = ReturnType<typeof makeStartNonpayment>;

/** Payment of the past-due amount before the date rescinds a pending nonpayment cancellation. */
export function makeCureNonpayment(deps: Deps) {
  return async function cureNonpayment(
    ctx: TenantContext,
    input: { policyId: string },
  ): Promise<{ status: "rescinded" | "not_pending" | "still_past_due" }> {
    const policy = await loadPolicy(deps, ctx, TENANT, input.policyId);
    const term = policy.currentTerm;

    if (term.status !== "pending_cancellation" || term.cancellation?.reason !== NONPAYMENT) {
      return { status: "not_pending" };
    }

    const pastDue = await deps.billing.pastDue(ctx, input.policyId);

    if (pastDue && Number(pastDue.amount) > 0) return { status: "still_past_due" };

    const pending = policy.transaction(term.cancellation.transactionId);
    const delivery = pending.details?.cancellation?.delivery ?? "electronic";

    const notice =
      delivery === NO_NOTICE
        ? null
        : await renderNotice(
            deps,
            ctx,
            policy,
            { details: pending.details!, effectiveDate: pending.effectiveDate },
            { kind: "rescission" },
          );

    const key = `tenants/${ctx.tenantId}/policies/${policy.id}/notices/${newId()}.pdf`;

    if (notice) await deps.storage.put({ key, body: notice.pdf, contentType: "application/pdf" });

    const actor = { type: "system" as const, name: "Billing" };

    const rescission = await deps.uow.run(ctx, async (tx) => {
      const current = await loadPolicy(deps, ctx, TENANT, input.policyId, tx);
      const clock = deps.clocks.forTenant(ctx.tenantId);

      const transaction = current.rescindCancellation(
        term.id,
        { actor, today: today(clock), note: "Payment received" },
        clock,
      );

      await billIssued(deps, tx, ctx, current, transaction.id, [], actor);

      if (notice) {
        current.attachDocument(
          {
            transactionId: transaction.id,
            kind: "rescission_notice",
            title: notice.title,
            storageKey: key,
            sizeBytes: notice.pdf.byteLength,
          },
          clock,
        );
      }

      await deps.policies.save(tx, current);
      await deps.outbox.add(tx, current.pullEvents());

      return transaction;
    });

    if (!notice) return { status: "rescinded" };

    const sent = policy
      .toSnapshot()
      .events.find((e) => e.type === "notice_sent" && e.data.transactionId === pending.id);

    await dispatchNotice(deps, ctx, TENANT, {
      policyId: input.policyId,
      transactionId: rescission.id,
      title: notice.title,
      pdf: notice.pdf,
      delivery,
      recipients: (sent?.data.recipients as string[] | undefined) ?? ["insured"],
    });

    return { status: "rescinded" };
  };
}

export type CureNonpayment = ReturnType<typeof makeCureNonpayment>;
