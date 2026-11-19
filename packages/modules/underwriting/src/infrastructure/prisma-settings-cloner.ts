import { prismaTx } from "@pas/db";
import type { IdRemap, TenantContext, UnitOfWork } from "@pas/kernel";

/** Sandboxes start with the tenant's authority profiles and decline reasons (product ids remapped). */
export class PrismaUnderwritingSettingsCloner {
  constructor(private readonly uow: UnitOfWork) {}

  async copy(from: TenantContext, to: TenantContext, ids: IdRemap) {
    const row = await this.uow.run(from, (tx) =>
      prismaTx(tx).underwritingSettings.findUnique({ where: { tenantId: from.tenantId } }),
    );

    if (!row) return { underwritingSettings: 0 };

    await this.uow.run(to, (tx) =>
      prismaTx(tx).underwritingSettings.create({
        data: {
          tenantId: to.tenantId,
          authorityProfiles: ids.rewrite(row.authorityProfiles) as object,
          declineReasons: row.declineReasons as object,
          overdueConsequence: row.overdueConsequence,
          updatedAt: row.updatedAt,
        },
      }),
    );

    return { underwritingSettings: 1 };
  }
}
