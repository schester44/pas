import { instantToDb, prismaTx } from "@pas/db";
import { Prisma } from "@pas/db/client";
import { conflict, newId, notFound, type TenantContext, type Transaction } from "@pas/kernel";
import type { OrganizationRef, TenantProfile } from "../domain/tenant-profile";
import type { TenantProfileRepository } from "../ports/tenant-profile-repository";
import { toOrganizationRef, toProfile } from "./mappers";

export class PrismaTenantProfileRepository implements TenantProfileRepository {
  async find(tx: Transaction, ctx: TenantContext): Promise<TenantProfile | null> {
    const db = prismaTx(tx);
    const row = await db.tenantProfile.findUnique({ where: { tenantId: ctx.tenantId } });

    if (!row) return null;

    const domains = await db.tenantDomain.findMany({
      where: { tenantId: ctx.tenantId },
      select: { hostname: true },
    });

    return toProfile(row, domains);
  }

  // Tenant = Better Auth organization, so its row is this context's own tenant record.
  async organization(tx: Transaction, ctx: TenantContext): Promise<OrganizationRef> {
    const row = await prismaTx(tx).organization.findUnique({
      where: { id: ctx.tenantId },
      select: { id: true, name: true, slug: true, createdAt: true },
    });

    if (!row) throw notFound("Organization", ctx.tenantId);

    return toOrganizationRef(row);
  }

  async save(tx: Transaction, profile: TenantProfile): Promise<void> {
    const db = prismaTx(tx);
    const p = profile.toSnapshot();

    const data = {
      displayName: p.displayName,
      primaryColor: p.primaryColor,
      logoUrl: p.logoUrl,
      appSubdomain: p.appSubdomain,
      supportEmail: p.supportEmail,
      supportPhone: p.supportPhone,
      updatedAt: instantToDb(p.updatedAt),
    };

    try {
      await db.tenantProfile.upsert({
        where: { tenantId: p.tenantId },
        create: { id: p.id, tenantId: p.tenantId, createdAt: instantToDb(p.createdAt), ...data },
        update: data,
      });

      await db.tenantDomain.deleteMany({
        where: { tenantId: p.tenantId, hostname: { notIn: p.customDomains } },
      });

      const existing = await db.tenantDomain.findMany({
        where: { tenantId: p.tenantId },
        select: { hostname: true },
      });

      const have = new Set(existing.map((d) => d.hostname));
      const added = p.customDomains.filter((hostname) => !have.has(hostname));

      if (added.length > 0) {
        await db.tenantDomain.createMany({
          data: added.map((hostname) => ({
            id: newId(),
            tenantId: p.tenantId,
            hostname,
            createdAt: instantToDb(p.updatedAt),
          })),
        });
      }
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw conflict("That subdomain or domain is already in use by another organization.");
      }

      throw error;
    }
  }
}
