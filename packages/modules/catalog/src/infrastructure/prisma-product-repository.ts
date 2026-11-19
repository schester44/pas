import { instantFromDb, instantToDb, prismaTx } from "@pas/db";
import type { ProductStatus as DbProductStatus, Product as ProductRow } from "@pas/db/client";
import { asId, type TenantContext, type Transaction } from "@pas/kernel";
import { Product, type ProductId, type ProductStatus } from "../domain/product";
import type { ProductRepository } from "../ports/product-repository";

const toDbStatus = (s: ProductStatus): DbProductStatus => s.toUpperCase() as DbProductStatus;
const fromDbStatus = (s: DbProductStatus): ProductStatus => s.toLowerCase() as ProductStatus;

export class PrismaProductRepository implements ProductRepository {
  async save(tx: Transaction, product: Product): Promise<void> {
    const p = product.toSnapshot();

    const data = {
      tenantId: p.tenantId,
      key: p.key,
      name: p.name,
      lineOfBusiness: p.lineOfBusiness,
      status: toDbStatus(p.status),
      createdAt: instantToDb(p.createdAt),
      updatedAt: instantToDb(p.updatedAt),
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

  async findById(tx: Transaction, ctx: TenantContext, id: ProductId): Promise<Product | null> {
    const row = await prismaTx(tx).product.findFirst({ where: { id, tenantId: ctx.tenantId } });

    return row ? toProduct(row) : null;
  }

  async findByKey(tx: Transaction, ctx: TenantContext, key: string): Promise<Product | null> {
    const row = await prismaTx(tx).product.findUnique({
      where: { tenantId_key: { tenantId: ctx.tenantId, key } },
    });

    return row ? toProduct(row) : null;
  }

  async list(tx: Transaction, ctx: TenantContext): Promise<Product[]> {
    const rows = await prismaTx(tx).product.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { createdAt: "desc" },
    });

    return rows.map(toProduct);
  }
}

function toProduct(row: ProductRow): Product {
  return Product.restore({
    id: asId(row.id),
    tenantId: asId(row.tenantId),
    key: row.key,
    name: row.name,
    lineOfBusiness: row.lineOfBusiness,
    status: fromDbStatus(row.status),
    createdAt: instantFromDb(row.createdAt),
    updatedAt: instantFromDb(row.updatedAt),
  });
}
