import { asId, type Money, type PlainDate, type TenantContext, type UnitOfWork } from "@pas/kernel";
import type { PolicyRepository } from "../ports/policy-repository";

export interface TransactionFinancialsDto {
  policyId: string;
  policyNumber: string;
  insuredName: string;
  productId: string;
  country: string;
  subdivision: string | null;
  termNumber: number;
  transactionId: string;
  transactionType: string;
  effectiveDate: PlainDate;
  producerId: string;
  agencyId: string | null;
  lines: { financialTransactionId: string; kind: string; amount: Money }[];
}

/** An issued transaction's financial transactions with the policy context commissions need. */
export function makeGetTransactionFinancials(deps: {
  uow: UnitOfWork;
  policies: PolicyRepository;
}) {
  return async function getTransactionFinancials(
    ctx: TenantContext,
    input: { policyId: string; transactionId: string },
  ): Promise<TransactionFinancialsDto | null> {
    const policy = await deps.uow.run(ctx, (tx) =>
      deps.policies.findById(tx, ctx, { kind: "tenant" }, asId(input.policyId)),
    );

    const state = policy?.toSnapshot();
    const transaction = state?.transactions.find((t) => t.id === input.transactionId);

    if (!state || !transaction || transaction.status !== "issued") return null;

    const term = state.terms.find((t) => t.id === transaction.termId)!;

    return {
      policyId: state.policy.id,
      policyNumber: state.policy.number,
      insuredName: state.policy.insuredName,
      productId: state.policy.productId,
      country: term.jurisdiction.country,
      subdivision: term.jurisdiction.subdivision ?? null,
      termNumber: term.termNumber,
      transactionId: transaction.id,
      transactionType: transaction.type,
      effectiveDate: transaction.effectiveDate,
      producerId: state.policy.producer.id,
      agencyId: state.policy.producer.agencyId,
      lines: state.financials
        .filter((f) => f.transactionId === transaction.id)
        .map((f) => ({ financialTransactionId: f.id, kind: f.kind, amount: f.amount })),
    };
  };
}

export type GetTransactionFinancials = ReturnType<typeof makeGetTransactionFinancials>;
