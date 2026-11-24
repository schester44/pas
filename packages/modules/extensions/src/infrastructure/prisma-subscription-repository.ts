import { instantFromDb, instantToDb, jsonToDb, prismaTx } from "@pas/db";
import type { ExtensionSubscription as Row } from "@pas/db/client";
import { asId, type TenantContext, type Transaction } from "@pas/kernel";
import type { ExtensionId } from "../domain/extension";
import type { AutomationSubscription, SubscriptionId } from "../domain/subscription";
import type { SubscriptionRepository } from "../ports/repositories";

const toSubscription = (row: Row): AutomationSubscription => ({
  id: asId(row.id),
  tenantId: asId(row.tenantId),
  extensionId: asId(row.extensionId),
  extensionVersionId: asId(row.extensionVersionId),
  eventTypes: row.eventTypes as string[],
  condition: row.condition,
  enabled: row.enabled,
  createdAt: instantFromDb(row.createdAt),
  updatedAt: instantFromDb(row.updatedAt),
});

export class PrismaSubscriptionRepository implements SubscriptionRepository {
  async save(tx: Transaction, s: AutomationSubscription): Promise<void> {
    const data = {
      extensionVersionId: s.extensionVersionId,
      eventTypes: jsonToDb(s.eventTypes),
      condition: s.condition,
      enabled: s.enabled,
      updatedAt: instantToDb(s.updatedAt),
    };

    await prismaTx(tx).extensionSubscription.upsert({
      where: { id: s.id },
      create: {
        id: s.id,
        tenantId: s.tenantId,
        extensionId: s.extensionId,
        createdAt: instantToDb(s.createdAt),
        ...data,
      },
      update: data,
    });
  }

  async delete(tx: Transaction, ctx: TenantContext, id: SubscriptionId): Promise<void> {
    await prismaTx(tx).extensionSubscription.deleteMany({ where: { id, tenantId: ctx.tenantId } });
  }

  async find(tx: Transaction, ctx: TenantContext, id: SubscriptionId) {
    const row = await prismaTx(tx).extensionSubscription.findFirst({
      where: { id, tenantId: ctx.tenantId },
    });

    return row ? toSubscription(row) : null;
  }

  async forExtension(tx: Transaction, ctx: TenantContext, extensionId: ExtensionId) {
    const rows = await prismaTx(tx).extensionSubscription.findMany({
      where: { tenantId: ctx.tenantId, extensionId },
      orderBy: { createdAt: "asc" },
    });

    return rows.map(toSubscription);
  }

  async enabledFor(tx: Transaction, ctx: TenantContext, eventType: string) {
    const rows = await prismaTx(tx).extensionSubscription.findMany({
      where: { tenantId: ctx.tenantId, enabled: true, eventTypes: { array_contains: [eventType] } },
    });

    return rows.map(toSubscription);
  }
}
