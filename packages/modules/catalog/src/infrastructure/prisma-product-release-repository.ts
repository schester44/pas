import { instantFromDb, instantToDb, plainDateFromDb, plainDateToDb, prismaTx } from "@pas/db";
import type { Prisma, ProductRelease as ProductReleaseRow } from "@pas/db/client";
import { asId, type Jurisdiction, type TenantContext, type Transaction } from "@pas/kernel";
import type { ProductId } from "../domain/product";
import {
  completeManifest,
  ProductRelease,
  type ProductReleaseId,
  type ReleaseManifest,
} from "../domain/product-release";
import type { ProductReleaseRepository } from "../ports/product-release-repository";

export class PrismaProductReleaseRepository implements ProductReleaseRepository {
  async insert(tx: Transaction, releases: readonly ProductRelease[]): Promise<void> {
    if (releases.length === 0) return;

    await prismaTx(tx).productRelease.createMany({
      data: releases.map((release) => {
        const r = release.toSnapshot();

        return {
          id: r.id,
          tenantId: r.tenantId,
          productId: r.productId,
          productVersionId: r.productVersionId,
          version: r.version,
          country: r.jurisdiction.country,
          subdivision: r.jurisdiction.subdivision ?? null,
          newBusinessFrom: plainDateToDb(r.newBusiness.from),
          newBusinessTo: r.newBusiness.to ? plainDateToDb(r.newBusiness.to) : null,
          renewalFrom: plainDateToDb(r.renewal.from),
          renewalTo: r.renewal.to ? plainDateToDb(r.renewal.to) : null,
          manifest: r.manifest as unknown as Prisma.InputJsonValue,
          contentHash: r.contentHash,
          publishedAt: instantToDb(r.publishedAt),
        };
      }),
    });
  }

  async findById(
    tx: Transaction,
    ctx: TenantContext,
    id: ProductReleaseId,
  ): Promise<ProductRelease | null> {
    const row = await prismaTx(tx).productRelease.findFirst({
      where: { id, tenantId: ctx.tenantId },
    });

    return row ? toRelease(row) : null;
  }

  async listByProduct(
    tx: Transaction,
    ctx: TenantContext,
    productId: ProductId,
  ): Promise<ProductRelease[]> {
    const rows = await prismaTx(tx).productRelease.findMany({
      where: { tenantId: ctx.tenantId, productId },
      orderBy: [{ publishedAt: "desc" }, { country: "asc" }, { subdivision: "asc" }],
    });

    return rows.map(toRelease);
  }

  async listResolvable(
    tx: Transaction,
    ctx: TenantContext,
    productId: ProductId,
    jurisdiction: Jurisdiction,
  ): Promise<ProductRelease[]> {
    const rows = await prismaTx(tx).productRelease.findMany({
      where: {
        tenantId: ctx.tenantId,
        productId,
        country: jurisdiction.country,
        subdivision: jurisdiction.subdivision ?? null,
        productVersion: { status: "PUBLISHED" },
      },
    });

    return rows.map(toRelease);
  }

  async listOffered(tx: Transaction, ctx: TenantContext): Promise<ProductRelease[]> {
    const rows = await prismaTx(tx).productRelease.findMany({
      where: { tenantId: ctx.tenantId, productVersion: { status: "PUBLISHED" } },
    });

    return rows.map(toRelease);
  }
}

function toRelease(row: ProductReleaseRow): ProductRelease {
  const jurisdiction: Jurisdiction = row.subdivision
    ? { country: row.country, subdivision: row.subdivision }
    : { country: row.country };

  return ProductRelease.restore({
    id: asId(row.id),
    tenantId: asId(row.tenantId),
    productId: asId(row.productId),
    productVersionId: asId(row.productVersionId),
    version: row.version,
    jurisdiction,
    newBusiness: {
      from: plainDateFromDb(row.newBusinessFrom),
      ...(row.newBusinessTo && { to: plainDateFromDb(row.newBusinessTo) }),
    },
    renewal: {
      from: plainDateFromDb(row.renewalFrom),
      ...(row.renewalTo && { to: plainDateFromDb(row.renewalTo) }),
    },
    manifest: completeManifest(row.manifest as unknown as ReleaseManifest),
    contentHash: row.contentHash,
    publishedAt: instantFromDb(row.publishedAt),
  });
}
