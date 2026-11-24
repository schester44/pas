import { instantFromDb, instantToDb, prismaTx } from "@pas/db";
import type { OfferingStatus as DbOfferingStatus, Offering as OfferingRow } from "@pas/db/client";
import { asId, type TenantContext, type Transaction } from "@pas/kernel";
import {
  Offering,
  type OfferingId,
  type OfferingStatus,
  type SelectionStrategy,
} from "../domain/offering";
import type { OfferingRepository } from "../ports/offering-repository";

const toDbStatus = (s: OfferingStatus): DbOfferingStatus => s.toUpperCase() as DbOfferingStatus;
const fromDbStatus = (s: DbOfferingStatus): OfferingStatus => s.toLowerCase() as OfferingStatus;

export class PrismaOfferingRepository implements OfferingRepository {
  async save(tx: Transaction, offering: Offering): Promise<void> {
    const o = offering.toSnapshot();

    const data = {
      tenantId: o.tenantId,
      key: o.key,
      name: o.name,
      productIds: o.productIds,
      selection: o.selection,
      status: toDbStatus(o.status),
      createdAt: instantToDb(o.createdAt),
      updatedAt: instantToDb(o.updatedAt),
    };

    await prismaTx(tx).offering.upsert({
      where: { id: o.id },
      create: { id: o.id, ...data },
      update: data,
    });
  }

  async existsByKey(tx: Transaction, ctx: TenantContext, key: string): Promise<boolean> {
    const row = await prismaTx(tx).offering.findUnique({
      where: { tenantId_key: { tenantId: ctx.tenantId, key } },
      select: { id: true },
    });

    return row !== null;
  }

  async findById(tx: Transaction, ctx: TenantContext, id: OfferingId): Promise<Offering | null> {
    const row = await prismaTx(tx).offering.findFirst({ where: { id, tenantId: ctx.tenantId } });

    return row ? toOffering(row) : null;
  }

  async list(tx: Transaction, ctx: TenantContext): Promise<Offering[]> {
    const rows = await prismaTx(tx).offering.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { name: "asc" },
    });

    return rows.map(toOffering);
  }
}

function toOffering(row: OfferingRow): Offering {
  return Offering.restore({
    id: asId(row.id),
    tenantId: asId(row.tenantId),
    key: row.key,
    name: row.name,
    productIds: row.productIds,
    selection: row.selection as SelectionStrategy,
    status: fromDbStatus(row.status),
    createdAt: instantFromDb(row.createdAt),
    updatedAt: instantFromDb(row.updatedAt),
  });
}
