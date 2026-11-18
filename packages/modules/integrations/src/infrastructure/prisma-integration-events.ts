import { prismaTx } from "@pas/db";
import type { TenantContext, Transaction } from "@pas/kernel";
import type { IntegrationEventRecord, IntegrationEvents } from "../ports/integration-events";
import { json, toDate, toInstant } from "./mappers";

export class PrismaIntegrationEvents implements IntegrationEvents {
  async add(tx: Transaction, ctx: TenantContext, event: IntegrationEventRecord): Promise<boolean> {
    const db = prismaTx(tx);

    const data = {
      id: event.id,
      tenantId: ctx.tenantId,
      installId: event.installId,
      providerId: event.providerId,
      kind: event.kind,
      outcome: event.outcome,
      summary: event.summary,
      externalId: event.externalId,
      data: json(event.data),
      occurredAt: toDate(event.occurredAt),
    };

    if (!event.externalId) {
      await db.integrationEvent.create({ data });

      return true;
    }

    const created = await db.integrationEvent.createMany({ data: [data], skipDuplicates: true });

    return created.count > 0;
  }

  async recent(tx: Transaction, ctx: TenantContext, providerId: string, limit: number) {
    const rows = await prismaTx(tx).integrationEvent.findMany({
      where: { tenantId: ctx.tenantId, providerId },
      orderBy: { occurredAt: "desc" },
      take: limit,
    });

    return rows.map((row): IntegrationEventRecord => ({
      id: row.id,
      installId: row.installId,
      providerId: row.providerId,
      kind: row.kind as IntegrationEventRecord["kind"],
      outcome: row.outcome as IntegrationEventRecord["outcome"],
      summary: row.summary,
      externalId: row.externalId,
      data: row.data as Record<string, unknown>,
      occurredAt: toInstant(row.occurredAt),
    }));
  }
}
