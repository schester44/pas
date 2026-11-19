import { instantFromDb, prismaTx } from "@pas/db";
import type { Prisma } from "@pas/db/client";
import { newId, type TenantContext, type Transaction } from "@pas/kernel";
import type { BillingEvent } from "../domain/billing-event";
import type { AppliedBillingEvent, BillingEventLog } from "../ports/billing-event-log";

export class PrismaBillingEventLog implements BillingEventLog {
  async record(
    tx: Transaction,
    ctx: TenantContext,
    event: Omit<BillingEvent, "invoiceId"> & { invoiceId: string | null; policyId: string | null },
  ): Promise<boolean> {
    const { eventId, source, type, invoiceId, policyId, occurredAt, ...rest } = event;

    const payload = JSON.parse(
      JSON.stringify({
        ...rest,
        amount: rest.amount?.toJSON(),
        lines: rest.lines?.map((l) => ({ ...l, amount: l.amount.toJSON() })),
      }),
    ) as Prisma.InputJsonValue;

    const inserted = await prismaTx(tx).$executeRaw`
      insert into billing_events (id, tenant_id, source, event_id, type, invoice_id, policy_id, payload, occurred_at, applied_at)
      values (${newId()}::uuid, ${ctx.tenantId}, ${source}, ${eventId}, ${type}, ${invoiceId}::uuid, ${policyId}::uuid,
              ${JSON.stringify(payload)}::jsonb, ${new Date(occurredAt.epochMilliseconds)}, now())
      on conflict (tenant_id, source, event_id) do nothing`;

    return inserted > 0;
  }

  async listApplied(tx: Transaction, ctx: TenantContext): Promise<AppliedBillingEvent[]> {
    const rows = await prismaTx(tx).billingEvent.findMany({
      where: { tenantId: ctx.tenantId, invoiceId: { not: null } },
      orderBy: { appliedAt: "asc" },
    });

    return rows.map((row) => ({
      eventId: row.eventId,
      source: row.source,
      type: row.type,
      invoiceId: row.invoiceId!,
      occurredAt: instantFromDb(row.occurredAt),
      payload: row.payload as Record<string, unknown>,
    }));
  }

  async findPolicyByNumber(tx: Transaction, ctx: TenantContext, number: string) {
    const row = await prismaTx(tx).invoice.findFirst({
      where: { tenantId: ctx.tenantId, policyNumber: number },
      select: { policyId: true },
    });

    return row?.policyId ?? null;
  }
}
