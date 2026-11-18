import { DomainError, newId, type TenantContext } from "@pas/kernel";
import type { ObjectStorage } from "@pas/storage";
import type { Policy } from "../domain/policy";
import type { TimelineActor } from "../domain/policy-event";
import type { PolicyScope } from "../domain/scope";
import { coveragesOf } from "../domain/term-state";
import { premiumOf } from "../domain/transaction";
import type { NoticeDocuments } from "../ports/notice-documents";
import { type TransactionDto, toTransactionDto } from "./dto";
import {
  billIssued,
  type CancellationPricing,
  type ChangeDeps,
  loadPolicy,
  today,
} from "./pricing";

export type CancellationDeps = ChangeDeps & { notices: NoticeDocuments; storage: ObjectStorage };

const plain = (date: { toString(): string }) => date.toString();

async function renderNotice(
  deps: CancellationDeps,
  ctx: TenantContext,
  policy: Policy,
  pricing: CancellationPricing,
) {
  const term = policy.currentTerm;
  const snapshot = policy.latestVersion(term.id).snapshot;
  const release = await deps.config.release(ctx, term.productReleaseId);

  const parties = (snapshot.parties ?? {}) as {
    mailingAddress?: never;
    producer?: { name: string; agency?: string };
  };

  const risk = (snapshot.risk ?? {}) as Record<string, unknown>;
  const cancellation = pricing.details.cancellation!;
  const p = policy.toSnapshot().policy;

  return deps.notices.render(ctx, {
    release,
    context: {
      product: { name: p.productName, version: term.productVersion },
      policy: {
        number: p.number,
        effectiveDate: plain(term.effectiveDate),
        expirationDate: plain(term.expirationDate),
        issuedDate: plain(today(deps.clocks.forTenant(ctx.tenantId))),
        jurisdiction: term.jurisdiction,
        transaction: "cancellation",
      },
      namedInsured: {
        name: p.insuredName,
        ...((parties.mailingAddress ?? risk.mailingAddress)
          ? { mailingAddress: (parties.mailingAddress ?? risk.mailingAddress) as never }
          : {}),
      },
      ...(parties.producer && { producer: parties.producer }),
      risk,
      coverages: coveragesOf(snapshot).map((c) => ({
        code: c.coverage,
        name: c.name,
        ...(c.limit !== undefined && { limit: c.limit as never }),
        ...(c.deductible !== undefined && { deductible: c.deductible as never }),
        premium: c.premium.toJSON(),
      })),
    },
    notice: {
      title:
        cancellation.initiator === "insured"
          ? "Cancellation confirmation"
          : "Notice of cancellation",
      reasonLabel: cancellation.reasonLabel,
      noticeDate: cancellation.noticeDate,
      effectiveDate: plain(pricing.effectiveDate),
      minDaysNotice: cancellation.minDaysNotice,
      returnPremium: premiumOf(pricing.details, term.writtenPremium.currency).negated().toJSON(),
    },
  });
}

/**
 * Schedules a priced cancellation: notice generated and recorded, term pending_cancellation, and
 * the CANCELLATION issued at once when it's already effective (PLAN §7.3, §17.3).
 */
export async function commitCancellation(
  deps: CancellationDeps,
  ctx: TenantContext,
  scope: PolicyScope,
  input: {
    policyId: string;
    pricing: CancellationPricing;
    transactionId?: string;
    actor: TimelineActor;
    approvedBy?: TimelineActor;
  },
): Promise<TransactionDto> {
  const policy = await loadPolicy(deps, ctx, scope, input.policyId);
  const term = policy.currentTerm;
  const base = policy.latestVersion(term.id).version;
  const notice = await renderNotice(deps, ctx, policy, input.pricing);
  const key = `tenants/${ctx.tenantId}/policies/${policy.id}/notices/${newId()}.pdf`;

  await deps.storage.put({ key, body: notice.pdf, contentType: "application/pdf" });

  return deps.uow.run(ctx, async (tx) => {
    const current = await loadPolicy(deps, ctx, scope, input.policyId, tx);

    if (current.latestVersion(term.id).version !== base) {
      throw new DomainError(
        "precondition_failed",
        "The policy just changed. Start the cancellation again.",
      );
    }

    const transaction = current.quoteTransaction(
      {
        termId: term.id,
        type: "CANCELLATION",
        ...(input.transactionId && { transactionId: input.transactionId }),
        effectiveDate: input.pricing.effectiveDate,
        details: {
          ...input.pricing.details,
          ...(input.approvedBy && { approvedBy: input.approvedBy }),
        },
        actor: input.actor,
      },
      deps.clocks.forTenant(ctx.tenantId),
    );

    current.scheduleCancellation(
      transaction.id,
      input.approvedBy ?? input.actor,
      deps.clocks.forTenant(ctx.tenantId),
    );

    current.attachDocument(
      {
        transactionId: transaction.id,
        kind: "cancellation_notice",
        title: notice.title,
        storageKey: key,
        sizeBytes: notice.pdf.byteLength,
      },
      deps.clocks.forTenant(ctx.tenantId),
    );

    current.recordNoticeSent(
      {
        transactionId: transaction.id,
        title: notice.title,
        delivery: input.pricing.earliest.delivery,
        recipients: [...input.pricing.rule.recipients],
      },
      { type: "system", name: "Notices" },
      deps.clocks.forTenant(ctx.tenantId),
    );

    const now = today(deps.clocks.forTenant(ctx.tenantId));

    if (Temporal.PlainDate.compare(input.pricing.effectiveDate, now) <= 0) {
      const charges = current.issueTransaction(
        transaction.id,
        now,
        deps.clocks.forTenant(ctx.tenantId),
      );

      await billIssued(
        deps,
        tx,
        ctx,
        current,
        transaction.id,
        charges,
        input.approvedBy ?? input.actor,
      );
    }

    await deps.policies.save(tx, current);
    await deps.outbox.add(tx, current.pullEvents());

    return toTransactionDto(current.transaction(transaction.id));
  });
}
