import { prismaTx } from "@pas/db";
import type { Prisma } from "@pas/db/client";
import type { IdRemap, TenantContext, UnitOfWork } from "@pas/kernel";

/** Sandbox copies reference the same stored workbooks; uploads are immutable, so sharing is safe. */
export class PrismaRaterWorkbookCloner {
  constructor(private readonly uow: UnitOfWork) {}

  async copy(from: TenantContext, to: TenantContext, ids: IdRemap) {
    const rows = await this.uow.run(from, (tx) =>
      prismaTx(tx).raterWorkbook.findMany({ where: { tenantId: from.tenantId } }),
    );

    await this.uow.run(to, (tx) =>
      prismaTx(tx).raterWorkbook.createMany({
        data: rows.map((row) => ({
          ...row,
          id: ids.id(row.id),
          tenantId: to.tenantId,
          report: row.report as Prisma.InputJsonValue,
        })),
      }),
    );

    return { raterWorkbooks: rows.length };
  }
}
