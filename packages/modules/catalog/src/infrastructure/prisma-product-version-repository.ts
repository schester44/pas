import { prismaTx } from "@pas/db";
import { Prisma as PrismaRuntime } from "@pas/db/client";
import type {
  ProductVersionStatus as DbStatus,
  Prisma,
  ProductVersion as ProductVersionRow,
} from "@pas/db/client";
import { asId, type TenantContext, type Transaction } from "@pas/kernel";
import { billingConfigOf } from "@pas/pay-plans";
import {
  type AvailabilityWindowJson,
  availabilityFromJson,
  availabilityToJson,
} from "../domain/availability";
import type { ProductId } from "../domain/product";
import {
  ProductVersion,
  type ProductVersionId,
  type ProductVersionStatus,
} from "../domain/product-version";
import type { VersionContents } from "../domain/version-contents";
import type { ProductVersionRepository } from "../ports/product-version-repository";
import { toDate, toInstant } from "./mappers";

const toDbStatus = (s: ProductVersionStatus): DbStatus => s.toUpperCase() as DbStatus;
const fromDbStatus = (s: DbStatus): ProductVersionStatus => s.toLowerCase() as ProductVersionStatus;
const json = (value: unknown) => value as Prisma.InputJsonValue;

export class PrismaProductVersionRepository implements ProductVersionRepository {
  async save(tx: Transaction, version: ProductVersion): Promise<void> {
    const v = version.toSnapshot();

    const data = {
      status: toDbStatus(v.status),
      riskSchema: json(v.contents.riskSchema),
      forms: json(v.contents.forms),
      coverages: json(v.contents.coverages),
      availability: json(v.contents.availability.map(availabilityToJson)),
      lifecycle: json(v.contents.lifecycle),
      documents: json(v.contents.documents),
      rules: json(v.contents.rules),
      rating: v.contents.rating === null ? PrismaRuntime.DbNull : json(v.contents.rating),
      billing: json(v.contents.billing),
      updatedAt: toDate(v.updatedAt),
      publishedAt: v.publishedAt ? toDate(v.publishedAt) : null,
      retiredAt: v.retiredAt ? toDate(v.retiredAt) : null,
    };

    await prismaTx(tx).productVersion.upsert({
      where: { id: v.id },
      create: {
        id: v.id,
        tenantId: v.tenantId,
        productId: v.productId,
        version: v.version,
        basedOnId: v.basedOnId,
        createdAt: toDate(v.createdAt),
        ...data,
      },
      update: data,
    });
  }

  async findById(
    tx: Transaction,
    ctx: TenantContext,
    id: ProductVersionId,
  ): Promise<ProductVersion | null> {
    const row = await prismaTx(tx).productVersion.findFirst({
      where: { id, tenantId: ctx.tenantId },
    });

    return row ? toVersion(row) : null;
  }

  async listByProduct(
    tx: Transaction,
    ctx: TenantContext,
    productId: ProductId,
  ): Promise<ProductVersion[]> {
    const rows = await prismaTx(tx).productVersion.findMany({
      where: { tenantId: ctx.tenantId, productId },
      orderBy: { createdAt: "desc" },
    });

    return rows.map(toVersion);
  }

  async existsByLabel(
    tx: Transaction,
    ctx: TenantContext,
    productId: ProductId,
    version: string,
  ): Promise<boolean> {
    const row = await prismaTx(tx).productVersion.findFirst({
      where: { tenantId: ctx.tenantId, productId, version },
      select: { id: true },
    });

    return row !== null;
  }
}

function toVersion(row: ProductVersionRow): ProductVersion {
  return ProductVersion.restore({
    id: asId(row.id),
    tenantId: asId(row.tenantId),
    productId: asId(row.productId),
    version: row.version,
    status: fromDbStatus(row.status),
    contents: {
      riskSchema: row.riskSchema as unknown as VersionContents["riskSchema"],
      forms: row.forms as unknown as VersionContents["forms"],
      coverages: row.coverages as unknown as VersionContents["coverages"],
      availability: (row.availability as unknown as AvailabilityWindowJson[]).map(
        availabilityFromJson,
      ),
      lifecycle: row.lifecycle as VersionContents["lifecycle"],
      documents: row.documents as unknown as VersionContents["documents"],
      rules: row.rules as unknown as VersionContents["rules"],
      rating: row.rating as unknown as VersionContents["rating"],
      billing: billingConfigOf(row.billing),
    },
    basedOnId: row.basedOnId ? asId(row.basedOnId) : null,
    createdAt: toInstant(row.createdAt),
    updatedAt: toInstant(row.updatedAt),
    publishedAt: row.publishedAt ? toInstant(row.publishedAt) : null,
    retiredAt: row.retiredAt ? toInstant(row.retiredAt) : null,
  });
}
