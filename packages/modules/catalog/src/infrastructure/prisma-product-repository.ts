import { prismaTx } from "@pas/db";
import type { ProductStatus as DbProductStatus } from "@pas/db/client";
import { asId, type TenantContext, type Transaction } from "@pas/kernel";
import { Product, type ProductStatus } from "../domain/product";
import type { ProductRepository } from "../ports/product-repository";

const toDbStatus = (s: ProductStatus): DbProductStatus => s.toUpperCase() as DbProductStatus;
const fromDbStatus = (s: DbProductStatus): ProductStatus => s.toLowerCase() as ProductStatus;
const toDate = (i: Temporal.Instant) => new Date(i.epochMilliseconds);
const toInstant = (d: Date) => Temporal.Instant.fromEpochMilliseconds(d.getTime());

export class PrismaProductRepository implements ProductRepository {
  async save(tx: Transaction, product: Product): Promise<void> {
    const p = product.toSnapshot();
    const data = {
      tenantId: p.tenantId,
      key: p.key,
      name: p.name,
      lineOfBusiness: p.lineOfBusiness,
      status: toDbStatus(p.status),
      createdAt: toDate(p.createdAt),
      updatedAt: toDate(p.updatedAt),
    };
    await prismaTx(tx).product.upsert({
      where: { id: p.id },
      create: { id: p.id, ...data },
      update: data,
    });
  }

  async existsByKey(tx: Transaction, ctx: TenantContext, key: string): Promise<boolean> {
    const row = await prismaTx(tx).product.findUnique({
      where: { tenantId_key: { tenantId: ctx.tenantId, key } },
      select: { id: true },
    });
    return row !== null;
  }

  async list(tx: Transaction, ctx: TenantContext): Promise<Product[]> {
    const rows = await prismaTx(tx).product.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((row) =>
      Product.restore({
        id: asId(row.id),
        tenantId: asId(row.tenantId),
        key: row.key,
        name: row.name,
        lineOfBusiness: row.lineOfBusiness,
        status: fromDbStatus(row.status),
        createdAt: toInstant(row.createdAt),
        updatedAt: toInstant(row.updatedAt),
      }),
    );
  }
}
