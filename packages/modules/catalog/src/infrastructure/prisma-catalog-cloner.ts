import { createHash } from "node:crypto";
import { prismaTx } from "@pas/db";
import { Prisma } from "@pas/db/client";
import { canonicalJson, type IdRemap, type TenantContext, type UnitOfWork } from "@pas/kernel";

const json = (value: Prisma.JsonValue, ids: IdRemap) => ids.rewrite(value) as Prisma.InputJsonValue;

/** Copies a tenant's offerings, products, versions and releases into a sandbox (PLAN §15.4). */
export class PrismaCatalogCloner {
  constructor(private readonly uow: UnitOfWork) {}

  async copy(from: TenantContext, to: TenantContext, ids: IdRemap) {
    const source = await this.uow.run(from, async (tx) => {
      const db = prismaTx(tx);
      const where = { tenantId: from.tenantId };

      return {
        products: await db.product.findMany({ where, orderBy: { createdAt: "asc" } }),
        versions: await db.productVersion.findMany({ where, orderBy: { createdAt: "asc" } }),
        releases: await db.productRelease.findMany({ where, orderBy: { publishedAt: "asc" } }),
        offerings: await db.offering.findMany({ where, orderBy: { createdAt: "asc" } }),
      };
    });

    for (const row of [
      ...source.products,
      ...source.versions,
      ...source.releases,
      ...source.offerings,
    ]) {
      ids.id(row.id);
    }

    await this.uow.run(to, async (tx) => {
      const db = prismaTx(tx);

      await db.product.createMany({
        data: source.products.map((p) => ({ ...p, id: ids.id(p.id), tenantId: to.tenantId })),
      });

      await db.productVersion.createMany({
        data: source.versions.map((v) => ({
          ...v,
          id: ids.id(v.id),
          tenantId: to.tenantId,
          productId: ids.id(v.productId),
          basedOnId: ids.maybe(v.basedOnId),
          riskSchema: json(v.riskSchema, ids),
          forms: json(v.forms, ids),
          coverages: json(v.coverages, ids),
          availability: json(v.availability, ids),
          lifecycle: json(v.lifecycle, ids),
          documents: json(v.documents, ids),
          rules: json(v.rules, ids),
          rating: v.rating === null ? Prisma.DbNull : json(v.rating, ids),
          billing: json(v.billing, ids),
          extensions: json(v.extensions, ids),
          enrichment: json(v.enrichment, ids),
        })),
      });

      await db.productRelease.createMany({
        data: source.releases.map((r) => {
          const manifest = ids.rewrite(r.manifest);

          return {
            ...r,
            id: ids.id(r.id),
            tenantId: to.tenantId,
            productId: ids.id(r.productId),
            productVersionId: ids.id(r.productVersionId),
            manifest: manifest as Prisma.InputJsonValue,
            contentHash: createHash("sha256").update(canonicalJson(manifest)).digest("hex"),
          };
        }),
      });

      await db.offering.createMany({
        data: source.offerings.map((o) => ({
          ...o,
          id: ids.id(o.id),
          tenantId: to.tenantId,
          productIds: o.productIds.map((id) => ids.id(id)),
        })),
      });
    });

    return {
      products: source.products.length,
      versions: source.versions.length,
      releases: source.releases.length,
      offerings: source.offerings.length,
    };
  }
}
