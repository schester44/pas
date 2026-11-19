import type { TenantContext } from "@pas/kernel";
import type {
  GetPolicy,
  GetTransactionFacts,
  GetTransactionFinancials,
  TransactionDto,
} from "@pas/policy";
import type { DownloadTransactionView } from "../domain/record";
import type { TransactionSource } from "../ports/sources";

const TENANT = { kind: "tenant" } as const;

function reasonOf(t: TransactionDto | undefined): string | null {
  if (!t) return null;

  if (t.cancellation) return t.cancellation.reasonLabel;

  if (t.reinstatement) {
    return t.reinstatement.lapse ? "Reinstated with a lapse" : "Reinstated without a lapse";
  }

  return t.note;
}

/** Policy administration and the catalog behind the agency downloads `TransactionSource` port. */
export function policyTransactionSource(deps: {
  facts: GetTransactionFacts;
  financials: GetTransactionFinancials;
  policies: GetPolicy;
  products: {
    get(ctx: TenantContext, input: { id: string }): Promise<{ lineOfBusiness: string }>;
    list(ctx: TenantContext): Promise<{ lineOfBusiness: string }[]>;
  };
}): TransactionSource {
  return {
    async view(ctx, input): Promise<DownloadTransactionView | null> {
      const financials = await deps.financials(ctx, input);

      if (!financials?.agencyId) return null;

      const [facts, detail] = await Promise.all([
        deps.facts(ctx, input),
        deps.policies.detail(ctx, TENANT, { id: input.policyId }),
      ]);

      const product = await deps.products.get(ctx, { id: facts.productId });
      const transaction = detail.transactions.find((t) => t.id === input.transactionId);

      return {
        policy: {
          id: facts.policyId,
          number: facts.policyNumber,
          productName: detail.productName,
          lineOfBusiness: product.lineOfBusiness,
          insuredName: facts.insuredName,
          jurisdiction: facts.jurisdiction,
          termEffectiveDate: facts.termEffectiveDate,
          termExpirationDate: facts.termExpirationDate,
          billingMethod: facts.billingMethod,
        },
        producer: { id: detail.producerId, name: detail.producerName, code: null },
        agency: { id: financials.agencyId, name: detail.producerAgency ?? "" },
        transaction: {
          id: facts.transaction.id,
          type: facts.transaction.type,
          effectiveDate: facts.transaction.effectiveDate,
          issuedAt: facts.transaction.issuedAt,
          premium: facts.transaction.premium,
          reason: reasonOf(transaction),
          changes: transaction?.changes ?? [],
        },
        premiumLines: financials.lines
          .filter((line) => line.kind === "written_premium")
          .map((line) => ({ code: line.code, label: line.label, amount: line.amount.toJSON() })),
        taxesFees: facts.taxesFees.map((t) => ({ code: t.code, label: t.label, amount: t.amount })),
        snapshot: facts.snapshot,
        documents: detail.documents
          .filter((d) => d.transactionId === input.transactionId)
          .map((d) => ({ id: d.id, kind: d.kind, title: d.title })),
      };
    },

    async document(ctx, input) {
      const file = await deps.policies.document(ctx, TENANT, input);

      return { fileName: file.fileName, body: file.body };
    },

    async linesOfBusiness(ctx) {
      const products = await deps.products.list(ctx);

      return [...new Set(products.map((p) => p.lineOfBusiness))].toSorted();
    },
  };
}
