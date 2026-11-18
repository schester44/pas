import { notFound, type TenantContext } from "@pas/kernel";
import { type ClientScope, clientMaySee } from "../domain/client-scope";
import type { BillingDirectory, CardInput } from "../ports/portal-services";
import { type ClientInvoiceDto, toClientInvoice } from "./portal-dto";

export type PayClientInvoiceResult =
  | { status: "paid"; invoice: ClientInvoiceDto }
  | { status: "declined"; message: string };

/** Invoices across the client's policies, and paying one by card. */
export function makeClientInvoices(deps: { billing: BillingDirectory }) {
  async function load(ctx: TenantContext, scope: ClientScope, id: string) {
    const invoice = await deps.billing.invoice(ctx, id);

    if (!invoice || !clientMaySee(scope, ctx.tenantId, invoice.policyId)) {
      throw notFound("Invoice", id);
    }

    return invoice;
  }

  return {
    async list(ctx: TenantContext, scope: ClientScope): Promise<ClientInvoiceDto[]> {
      if (scope.policyIds.length === 0) return [];

      return (await deps.billing.invoices(ctx, scope.policyIds)).map(toClientInvoice);
    },
    async get(ctx: TenantContext, scope: ClientScope, input: { id: string }) {
      return toClientInvoice(await load(ctx, scope, input.id));
    },
    async pay(
      ctx: TenantContext,
      scope: ClientScope,
      input: { id: string; card: CardInput; payerName: string },
    ): Promise<PayClientInvoiceResult> {
      await load(ctx, scope, input.id);

      const result = await deps.billing.pay(ctx, {
        invoiceId: input.id,
        card: input.card,
        actor: { type: "user", id: scope.userId, name: input.payerName },
      });

      return result.status === "paid"
        ? { status: "paid", invoice: toClientInvoice(result.invoice) }
        : result;
    },
  };
}

export type ClientInvoices = ReturnType<typeof makeClientInvoices>;
