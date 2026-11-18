import type { PrismaClient, PrismaTx } from "@pas/db";
import type { TenantProfile } from "../domain/tenant-profile";
import type { TenantDirectory, TenantListRecord, TenantRecord } from "../ports/tenant-directory";
import { toOrganizationRef, toProfile } from "./mappers";

const orgSelect = { id: true, name: true, slug: true, createdAt: true } as const;

// Host resolution runs before any tenant is known, so these reads bypass the tenant-scoped unit of work;
// `app.platform_read` unlocks the SELECT-only `platform_read` RLS policies.
export class PrismaTenantDirectory implements TenantDirectory {
  constructor(private readonly prisma: PrismaClient) {}

  findBySubdomain(subdomain: string): Promise<TenantRecord | null> {
    return this.platformRead(async (db) => {
      const row = await db.tenantProfile.findUnique({ where: { appSubdomain: subdomain } });

      if (row) return this.record(db, row.tenantId);

      const org = await db.organization.findUnique({
        where: { slug: subdomain },
        select: orgSelect,
      });

      if (!org) return null;

      const hasProfile = await db.tenantProfile.findUnique({
        where: { tenantId: org.id },
        select: { id: true },
      });

      return hasProfile
        ? null
        : {
            organization: toOrganizationRef(org),
            profile: null,
            sandbox: await isSandbox(db, org.id),
          };
    });
  }

  findByCustomDomain(hostname: string): Promise<TenantRecord | null> {
    return this.platformRead(async (db) => {
      const domain = await db.tenantDomain.findUnique({
        where: { hostname },
        select: { tenantId: true },
      });

      return domain ? this.record(db, domain.tenantId) : null;
    });
  }

  list(): Promise<TenantListRecord[]> {
    return this.platformRead(async (db) => {
      const [orgs, memberCounts, profiles, domains, sandboxes] = await Promise.all([
        db.organization.findMany({ select: orgSelect, orderBy: { createdAt: "desc" } }),
        db.member.groupBy({ by: ["organizationId"], _count: true }),
        db.tenantProfile.findMany(),
        db.tenantDomain.findMany({ select: { tenantId: true, hostname: true } }),
        db.tenantEnvironment.findMany({ where: { kind: "sandbox" }, select: { tenantId: true } }),
      ]);

      const sandboxIds = new Set(sandboxes.map((s) => s.tenantId));

      const membersByTenant = new Map(
        memberCounts.map((row) => [row.organizationId, Number(row["_count"])]),
      );

      const profileByTenant = new Map(profiles.map((p) => [p.tenantId, p]));

      return orgs.map((org) => {
        const row = profileByTenant.get(org.id);

        const profile: TenantProfile | null = row
          ? toProfile(
              row,
              domains.filter((d) => d.tenantId === org.id),
            )
          : null;

        return {
          organization: toOrganizationRef(org),
          profile,
          memberCount: membersByTenant.get(org.id) ?? 0,
          sandbox: sandboxIds.has(org.id),
        };
      });
    });
  }

  private async record(db: PrismaTx, tenantId: string): Promise<TenantRecord | null> {
    const org = await db.organization.findUnique({ where: { id: tenantId }, select: orgSelect });

    if (!org) return null;

    const [row, domains, sandbox] = await Promise.all([
      db.tenantProfile.findUnique({ where: { tenantId } }),
      db.tenantDomain.findMany({ where: { tenantId }, select: { hostname: true } }),
      isSandbox(db, tenantId),
    ]);

    return {
      organization: toOrganizationRef(org),
      profile: row ? toProfile(row, domains) : null,
      sandbox,
    };
  }

  private platformRead<T>(work: (db: PrismaTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (db) => {
      await db.$executeRaw`select set_config('app.platform_read', 'on', true)`;

      return work(db);
    });
  }
}

async function isSandbox(db: PrismaTx, tenantId: string): Promise<boolean> {
  const environment = await db.tenantEnvironment.findUnique({
    where: { tenantId },
    select: { kind: true },
  });

  return environment?.kind === "sandbox";
}
