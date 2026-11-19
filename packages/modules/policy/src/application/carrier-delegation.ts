import {
  type CanonicalInput,
  type Capability,
  type CarrierOutcome,
  carrierAssignmentOf,
  delegates,
  reconcileFigures,
  type TransactionKind,
} from "@pas/carriers";
import { Money, type TenantContext } from "@pas/kernel";
import { type CarrierCharges, withCarrierCharges } from "../domain/carrier-charges";
import type { Policy } from "../domain/policy";
import type { TimelineActor } from "../domain/policy-event";
import type { PolicyScope } from "../domain/scope";
import type {
  PolicyTransactionProps,
  TransactionDetails,
  TransactionType,
} from "../domain/transaction";
import { type TransactionDto, toTransactionDto } from "./dto";
import { type ChangeDeps, loadPolicy } from "./pricing";

const KINDS: Partial<Record<TransactionType, { kind: TransactionKind; capability: Capability }>> = {
  ENDORSEMENT: { kind: "endorsement", capability: "endorse" },
  CANCELLATION: { kind: "cancellation", capability: "cancel" },
  REINSTATEMENT: { kind: "reinstatement", capability: "reinstate" },
};

/** The carrier that owns this kind of change on the policy's release, if any. */
export async function carrierOwning(
  deps: ChangeDeps,
  ctx: TenantContext,
  policy: Policy,
  type: TransactionType,
) {
  const mapping = KINDS[type];

  if (!deps.carriers || !mapping) return null;

  const release = await deps.config.release(ctx, policy.currentTerm.productReleaseId);
  const assignment = carrierAssignmentOf(release.lifecycle);

  if (!assignment || !delegates(assignment.ownership, mapping.kind)) return null;

  return { ...assignment, capability: mapping.capability };
}

function canonicalChange(
  policy: Policy,
  transaction: PolicyTransactionProps,
  link: { carrierPolicyNumber: string | null; carrierReference: string | null } | null,
  capability: Capability,
): CanonicalInput {
  const p = policy.toSnapshot().policy;
  const term = policy.term(transaction.termId);
  const snapshot = transaction.details?.after ?? policy.latestVersion(term.id).snapshot;
  const details = transaction.details!;
  const currency = term.writtenPremium.currency;
  const parties = (snapshot.parties ?? {}) as { mailingAddress?: unknown };
  const change = details.premium.reduce((sum, line) => sum.plus(line.amount), Money.zero(currency));

  return {
    capability,
    product: {
      id: p.productId,
      name: p.productName,
      version: term.productVersion,
      releaseId: term.productReleaseId,
    },
    jurisdiction: term.jurisdiction,
    term: {
      effectiveDate: term.effectiveDate.toString(),
      expirationDate: term.expirationDate.toString(),
    },
    policy: {
      id: policy.id,
      number: policy.number,
      ...(link?.carrierPolicyNumber && { carrierNumber: link.carrierPolicyNumber }),
    },
    transaction: {
      id: transaction.id,
      type: transaction.type,
      effectiveDate: transaction.effectiveDate.toString(),
      ...(details.cancellation && { reason: details.cancellation.reason }),
      premiumChange: change.toJSON(),
    },
    insured: {
      name: p.insuredName,
      ...(parties.mailingAddress !== undefined && { mailingAddress: parties.mailingAddress }),
    },
    risk: (snapshot.risk ?? {}) as Record<string, unknown>,
    coverages: details.premium.map((line) => ({
      code: line.coverage,
      name: line.name,
      ...(line.exposure !== undefined && { exposure: line.exposure }),
      premium: line.amount.toJSON(),
    })),
    premium: {
      written: change.toJSON(),
      taxesFees: details.fees.map((fee) => ({
        code: fee.code,
        label: fee.label,
        amount: fee.amount.toJSON(),
      })),
      total: details.fees.reduce((sum, fee) => sum.plus(fee.amount), change).toJSON(),
    },
    carrier: {
      ...(link?.carrierPolicyNumber && { policyNumber: link.carrierPolicyNumber }),
      ...(link?.carrierReference && { reference: link.carrierReference }),
    },
  };
}

/**
 * Hands a quoted change to the carrier that owns it: the transaction waits in `pending_carrier`
 * and the carrier's flow (idempotency key = transaction id) decides (PLAN §12).
 */
export async function delegateToCarrier(
  deps: ChangeDeps,
  ctx: TenantContext,
  scope: PolicyScope,
  input: {
    policyId: string;
    transactionId: string;
    actor: TimelineActor;
    carrier: string;
    capability: Capability;
  },
): Promise<TransactionDto> {
  const carriers = deps.carriers!;
  const policy = await loadPolicy(deps, ctx, scope, input.policyId);
  const transaction = policy.transaction(input.transactionId);
  const link = await carriers.link(ctx, policy.id);
  const attempt = (transaction.details?.carrier?.attempt ?? 0) + 1;
  const name = await carriers.carrierName(ctx, input.carrier);

  const { flowRunId } = await carriers.start(ctx, {
    carrier: input.carrier,
    capability: input.capability,
    subject: {
      kind: "transaction",
      policyId: policy.id,
      transactionId: transaction.id,
      type: transaction.type,
    },
    input: canonicalChange(policy, transaction, link, input.capability),
    idempotencyKey: `transaction:${transaction.id}:a${attempt}`,
  });

  return deps.uow.run(ctx, async (tx) => {
    const current = await loadPolicy(deps, ctx, scope, input.policyId, tx);

    current.holdForCarrier(
      input.transactionId,
      { carrier: input.carrier, name, flowRunId, attempt },
      input.actor,
      deps.clocks.forTenant(ctx.tenantId),
    );

    await deps.policies.save(tx, current);
    await deps.outbox.add(tx, current.pullEvents());

    return toTransactionDto(current.transaction(input.transactionId));
  });
}

const figures = (d: TransactionDetails) => [
  ...d.premium.map((l) => ({
    key: l.exposure ? `${l.coverage}@${l.exposure}` : l.coverage,
    label: l.name,
    amount: l.amount,
  })),
  ...d.fees.map((f) => ({ key: f.code, label: f.label, amount: f.amount })),
];

/** Charges the carrier answered with, and the diff against ours, when its figures win. */
export function carrierChargesFor(
  details: TransactionDetails,
  outcome: CarrierOutcome,
  currency: string,
) {
  const premium = outcome.premium;

  if (!premium || premium.lines.length === 0) return null;

  const charges: CarrierCharges = {
    premium: premium.lines.map((line) => ({
      coverage: line.coverage,
      ...(line.exposure !== undefined && { exposure: line.exposure }),
      amount: Money.of(line.amount, currency),
    })),
    fees: premium.taxesFees.map((fee) => ({
      code: fee.code,
      label: fee.label,
      amount: Money.of(fee.amount, currency),
    })),
  };

  const replaced = withCarrierCharges(details, charges);

  const { diff } = reconcileFigures(figures(details), figures(replaced), currency);

  return { details: replaced, diff };
}
