import { prismaTx } from "@pas/db";
import { asId, type TenantContext, type Transaction } from "@pas/kernel";
import type { Licensee } from "../domain/licensee";
import type { LicenseeRepository } from "../ports/licensee-repository";

export class PrismaLicenseeRepository implements LicenseeRepository {
  async list(tx: Transaction, ctx: TenantContext): Promise<Licensee[]> {
    const rows = await prismaTx(tx).complianceLicensee.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: [{ jurisdiction: "asc" }, { name: "asc" }],
    });

    return rows.map((r) => ({
      id: asId(r.id),
      tenantId: asId(r.tenantId),
      name: r.name,
      licenseNumber: r.licenseNumber,
      jurisdiction: r.jurisdiction,
      active: r.active,
    }));
  }

  async save(tx: Transaction, licensee: Licensee): Promise<void> {
    const now = new Date();

    const values = {
      name: licensee.name,
      licenseNumber: licensee.licenseNumber,
      jurisdiction: licensee.jurisdiction,
      active: licensee.active,
    };

    await prismaTx(tx).complianceLicensee.upsert({
      where: { id: licensee.id },
      update: { ...values, updatedAt: now },
      create: {
        ...values,
        id: licensee.id,
        tenantId: licensee.tenantId,
        createdAt: now,
        updatedAt: now,
      },
    });
  }

  async remove(tx: Transaction, ctx: TenantContext, id: string): Promise<void> {
    await prismaTx(tx).complianceLicensee.deleteMany({ where: { tenantId: ctx.tenantId, id } });
  }
}
