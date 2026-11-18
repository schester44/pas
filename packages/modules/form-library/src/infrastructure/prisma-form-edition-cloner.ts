import { prismaTx } from "@pas/db";
import type { IdRemap, TenantContext, UnitOfWork } from "@pas/kernel";

/** Sandbox copies reference the same stored files; editions are immutable, so sharing is safe. */
export class PrismaFormEditionCloner {
  constructor(private readonly uow: UnitOfWork) {}

  async copy(from: TenantContext, to: TenantContext, ids: IdRemap) {
    const rows = await this.uow.run(from, (tx) =>
      prismaTx(tx).formEdition.findMany({ where: { tenantId: from.tenantId } }),
    );

    await this.uow.run(to, (tx) =>
      prismaTx(tx).formEdition.createMany({
        data: rows.map((row) => ({ ...row, id: ids.id(row.id), tenantId: to.tenantId })),
      }),
    );

    return { formEditions: rows.length };
  }
}
