import { Money, type TenantContext, type UnitOfWork } from "@pas/kernel";
import type { InvoiceRepository } from "../ports/invoice-repository";
import { type InvoiceDto, type PaymentDto, toInvoiceDto, toPaymentDto } from "./dto";

export interface PolicyBillingDto {
  invoices: InvoiceDto[];
  payments: PaymentDto[];
  balance: { amount: string; currency: string } | null;
}

/** Invoices, payments and the outstanding balance for one policy. Callers check policy access. */
export function makeGetPolicyBilling(deps: { uow: UnitOfWork; invoices: InvoiceRepository }) {
  return async function getPolicyBilling(
    ctx: TenantContext,
    input: { policyId: string },
  ): Promise<PolicyBillingDto> {
    return deps.uow.run(ctx, async (tx) => {
      const [invoices, payments] = await Promise.all([
        deps.invoices.listByPolicy(tx, ctx, input.policyId),
        deps.invoices.listPayments(tx, ctx, input.policyId),
      ]);

      const currency = invoices[0]?.toSnapshot().total.currency;

      const balance = currency
        ? invoices
            .filter((i) => i.toSnapshot().status !== "void")
            .reduce((sum, i) => sum.plus(i.balance), Money.zero(currency))
        : null;

      return {
        invoices: invoices.map(toInvoiceDto),
        payments: payments.map(toPaymentDto),
        balance: balance?.toJSON() ?? null,
      };
    });
  };
}

export type GetPolicyBilling = ReturnType<typeof makeGetPolicyBilling>;
