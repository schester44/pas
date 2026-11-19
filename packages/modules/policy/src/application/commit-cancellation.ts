import { DomainError, newId, type TenantContext } from "@pas/kernel";
import type { ObjectStorage } from "@pas/storage";
import type { Policy } from "../domain/policy";
import type { TimelineActor } from "../domain/policy-event";
import type { PolicyScope } from "../domain/scope";
import { coveragesOf } from "../domain/term-state";
import { premiumOf } from "../domain/transaction";
import type { NoticeDocuments } from "../ports/notice-documents";
import type { NoticeAddress, NoticeDelivery } from "../ports/notice-delivery";
import { type TransactionDto, toTransactionDto } from "./dto";
import {
  billIssued,
  type CancellationPricing,
  type ChangeDeps,
  loadPolicy,
  today,
} from "./pricing";

export type CancellationDeps = ChangeDeps & {
  notices: NoticeDocuments;
  storage: ObjectStorage;
  delivery: NoticeDelivery;
};

type MoneyJson = { amount: string; currency: string };

export type NoticeKind = { kind: "intent"; amountDue: MoneyJson } | { kind: "rescission" };

const TITLES = {
  intent: "Notice of intent to cancel for nonpayment",
  rescission: "Cancellation rescinded — payment received",
};

const plain = (date: { toString(): string }) => date.toString();

export async function renderNotice(
  deps: CancellationDeps,
  ctx: TenantContext,
  policy: Policy,
  pricing: Pick<CancellationPricing, "details" | "effectiveDate">,
  special?: NoticeKind,
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
      title: special
        ? TITLES[special.kind]
        : cancellation.initiator === "insured"
          ? "Cancellation confirmation"
          : "Notice of cancellation",
      ...(special && { kind: special.kind }),
      ...(special?.kind === "intent" && { amountDue: special.amountDue }),
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
    notice?: NoticeKind;
  },
): Promise<TransactionDto> {
  const policy = await loadPolicy(deps, ctx, scope, input.policyId);
  const term = policy.currentTerm;
  const base = policy.latestVersion(term.id).version;
  const notice = await renderNotice(deps, ctx, policy, input.pricing, input.notice);
  const key = `tenants/${ctx.tenantId}/policies/${policy.id}/notices/${newId()}.pdf`;

  await deps.storage.put({ key, body: notice.pdf, contentType: "application/pdf" });

  const committed = await deps.uow.run(ctx, async (tx) => {
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

  await dispatchNotice(deps, ctx, scope, {
    policyId: input.policyId,
    transactionId: committed.id,
    title: notice.title,
    pdf: notice.pdf,
    delivery: input.pricing.earliest.delivery,
    recipients: [...input.pricing.rule.recipients],
  });

  return committed;
}

/**
 * Emails the notice and, when the rule requires mail, mails it through print & mail; proof of
 * mailing arrives on the timeline from the mail provider (PLAN §17.3).
 */
export async function dispatchNotice(
  deps: CancellationDeps,
  ctx: TenantContext,
  scope: PolicyScope,
  input: {
    policyId: string;
    transactionId: string;
    title: string;
    pdf: Uint8Array;
    delivery: string;
    recipients: string[];
  },
): Promise<void> {
  const policy = await loadPolicy(deps, ctx, scope, input.policyId);
  const snapshot = policy.latestVersion(policy.currentTerm.id).snapshot;
  const risk = (snapshot.risk ?? {}) as Record<string, unknown>;

  const parties = (snapshot.parties ?? {}) as {
    mailingAddress?: NoticeAddress | null;
    additionalInterests?: { kind: string; name: string; address: NoticeAddress | null }[];
  };

  const sent = await deps.delivery.deliver(ctx, {
    policyId: policy.id,
    policyNumber: policy.number,
    transactionId: input.transactionId,
    title: input.title,
    pdf: input.pdf,
    delivery: input.delivery,
    recipients: input.recipients,
    insured: {
      name: policy.toSnapshot().policy.insuredName,
      address: parties.mailingAddress ?? (risk.mailingAddress as NoticeAddress | undefined) ?? null,
    },
    interests: input.recipients.includes("mortgagee")
      ? (parties.additionalInterests ?? []).filter((i) => i.kind === "mortgagee")
      : [],
  });

  await deps.uow.run(ctx, async (tx) => {
    const current = await loadPolicy(deps, ctx, scope, input.policyId, tx);

    current.recordNoticeSent(
      { ...input, ...sent },
      { type: "system", name: "Notices" },
      deps.clocks.forTenant(ctx.tenantId),
    );

    await deps.policies.save(tx, current);
  });
}
