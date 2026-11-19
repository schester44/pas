import { asId, notFound, type TenantContext, type UnitOfWork } from "@pas/kernel";
import type { PolicyRepository } from "../ports/policy-repository";

export interface TransactionFactsDto {
  policyId: string;
  policyNumber: string;
  productId: string;
  insuredName: string;
  termId: string;
  productReleaseId: string;
  jurisdiction: { country: string; subdivision?: string };
  termEffectiveDate: string;
  termExpirationDate: string;
  transaction: {
    id: string;
    type: string;
    effectiveDate: string;
    issuedAt: string;
    premium: { amount: string; currency: string };
  };
  taxesFees: {
    code: string;
    label: string;
    remitter: string | null;
    amount: { amount: string; currency: string };
  }[];
  /** The bound snapshot: risk, parties captured at bind and the bind-time decisions. */
  bound: Record<string, unknown>;
  risk: Record<string, unknown>;
  /** The term version this transaction produced (or the latest one before it). */
  snapshot: Record<string, unknown>;
  billingMethod: string;
}

/** What other contexts (compliance) need to know about one issued transaction. */
export function makeGetTransactionFacts(deps: { uow: UnitOfWork; policies: PolicyRepository }) {
  return async function getTransactionFacts(
    ctx: TenantContext,
    input: { policyId: string; transactionId: string },
  ): Promise<TransactionFactsDto> {
    const policy = await deps.uow.run(ctx, (tx) =>
      deps.policies.findById(tx, ctx, { kind: "tenant" }, asId(input.policyId)),
    );

    if (!policy) throw notFound("Policy", input.policyId);

    const state = policy.toSnapshot();
    const transaction = state.transactions.find((t) => t.id === input.transactionId);

    if (!transaction?.issuedAt) throw notFound("Issued transaction", input.transactionId);

    const term = policy.term(transaction.termId);

    const versions = state.versions
      .filter((v) => v.termId === term.id)
      .toSorted((a, b) => a.version - b.version);

    const latest = versions.findLast((v) => v.transactionId === transaction.id) ?? versions.at(-1);

    const risk = (latest?.snapshot.risk ?? versions[0]?.snapshot.risk ?? {}) as Record<
      string,
      unknown
    >;

    return {
      policyId: policy.id,
      policyNumber: policy.number,
      productId: state.policy.productId,
      insuredName: state.policy.insuredName,
      termId: term.id,
      productReleaseId: term.productReleaseId,
      jurisdiction: term.jurisdiction,
      termEffectiveDate: term.effectiveDate.toString(),
      termExpirationDate: term.expirationDate.toString(),
      transaction: {
        id: transaction.id,
        type: transaction.type,
        effectiveDate: transaction.effectiveDate.toString(),
        issuedAt: transaction.issuedAt.toString(),
        premium: transaction.premiumDelta.toJSON(),
      },
      taxesFees: state.financials
        .filter((f) => f.transactionId === transaction.id && f.kind === "tax_fee")
        .map((f) => ({
          code: f.code,
          label: f.label,
          remitter: f.remitter ?? null,
          amount: f.amount.toJSON(),
        })),
      bound: versions[0]?.snapshot ?? {},
      risk,
      snapshot: (latest?.snapshot ?? {}) as Record<string, unknown>,
      billingMethod: term.billingMethod,
    };
  };
}

export type GetTransactionFacts = ReturnType<typeof makeGetTransactionFacts>;
