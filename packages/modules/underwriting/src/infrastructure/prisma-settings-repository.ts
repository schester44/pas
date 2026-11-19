import { prismaTx } from "@pas/db";
import type { TenantContext, Transaction } from "@pas/kernel";
import { EMPTY_SETTINGS, type UnderwritingSettings } from "../domain/settings";
import type { SettingsRepository } from "../ports/repositories";
import { json } from "./json";

export class PrismaSettingsRepository implements SettingsRepository {
  async get(tx: Transaction, ctx: TenantContext): Promise<UnderwritingSettings> {
    const row = await prismaTx(tx).underwritingSettings.findUnique({
      where: { tenantId: ctx.tenantId },
    });

    if (!row) return EMPTY_SETTINGS;

    return {
      authorityProfiles:
        row.authorityProfiles as unknown as UnderwritingSettings["authorityProfiles"],
      declineReasons: row.declineReasons as unknown as UnderwritingSettings["declineReasons"],
      overdueConsequence: row.overdueConsequence,
    };
  }

  async save(tx: Transaction, ctx: TenantContext, settings: UnderwritingSettings): Promise<void> {
    const data = {
      authorityProfiles: json(settings.authorityProfiles),
      declineReasons: json(settings.declineReasons),
      overdueConsequence: settings.overdueConsequence,
      updatedAt: new Date(),
    };

    await prismaTx(tx).underwritingSettings.upsert({
      where: { tenantId: ctx.tenantId },
      update: data,
      create: { ...data, tenantId: ctx.tenantId },
    });
  }
}
