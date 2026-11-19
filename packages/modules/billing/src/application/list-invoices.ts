import { asId, type TenantContext, type UnitOfWork } from "@pas/kernel";
import type { InvoiceRepository } from "../ports/invoice-repository";
import { type InvoiceDto, toInvoiceDto } from "./dto";

/** Invoices by policy or ID. Callers check policy access. */
export function makeListInvoices(deps: { uow: UnitOfWork; invoices: InvoiceRepository }) {
  return {
    async forPolicies(ctx: TenantContext, input: { policyIds: readonly string[] }) {
      if (input.policyIds.length === 0) return [];

      const invoices = await deps.uow.run(ctx, (tx) =>
        deps.invoices.listByPolicies(tx, ctx, input.policyIds),
      );

      return invoices.map(toInvoiceDto);
    },
    /** Every invoice with its balance: what a billing system reconciles against. */
    async all(ctx: TenantContext): Promise<InvoiceDto[]> {
      return (await deps.uow.run(ctx, (tx) => deps.invoices.listAll(tx, ctx))).map(toInvoiceDto);
    },
    async byId(ctx: TenantContext, input: { id: string }): Promise<InvoiceDto | null> {
      const invoice = await deps.uow.run(ctx, (tx) =>
        deps.invoices.findById(tx, ctx, asId(input.id)),
      );

      return invoice ? toInvoiceDto(invoice) : null;
    },
  };
}

export type ListInvoices = ReturnType<typeof makeListInvoices>;
