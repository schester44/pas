import { prismaTx } from "@pas/db";
import type { Prisma } from "@pas/db/client";
import { asId, type TenantContext, type TenantId, type Transaction } from "@pas/kernel";
import { TenantEnvironment } from "../domain/tenant-environment";
import type { OrganizationRef } from "../domain/tenant-profile";
import type {
  FiredTimer,
  TenantEnvironmentRepository,
  TimeAdvance,
} from "../ports/tenant-environment-repository";
import { toDate, toInstant, toOrganizationRef } from "./mappers";

const orgSelect = { id: true, name: true, slug: true, createdAt: true } as const;

export class PrismaTenantEnvironmentRepository implements TenantEnvironmentRepository {
  async find(tx: Transaction, ctx: TenantContext): Promise<TenantEnvironment | null> {
    const row = await prismaTx(tx).tenantEnvironment.findUnique({
      where: { tenantId: ctx.tenantId },
    });

    return row
      ? TenantEnvironment.restore({
          tenantId: asId(row.tenantId),
          kind: row.kind,
          parentTenantId: row.parentTenantId ? asId(row.parentTenantId) : null,
          clockOffsetMs: Number(row.clockOffsetMs),
          createdAt: toInstant(row.createdAt),
          updatedAt: toInstant(row.updatedAt),
        })
      : null;
  }

  async save(tx: Transaction, environment: TenantEnvironment): Promise<void> {
    const e = environment.toSnapshot();

    const data = {
      kind: e.kind,
      parentTenantId: e.parentTenantId,
      clockOffsetMs: BigInt(e.clockOffsetMs),
      updatedAt: toDate(e.updatedAt),
    };

    await prismaTx(tx).tenantEnvironment.upsert({
      where: { tenantId: e.tenantId },
      create: { tenantId: e.tenantId, createdAt: toDate(e.createdAt), ...data },
      update: data,
    });
  }

  async sandboxes(tx: Transaction, ctx: TenantContext): Promise<OrganizationRef[]> {
    const db = prismaTx(tx);

    const rows = await db.tenantEnvironment.findMany({
      where: { parentTenantId: ctx.tenantId, kind: "sandbox" },
      select: { tenantId: true },
    });

    const orgs = await db.organization.findMany({
      where: { id: { in: rows.map((r) => r.tenantId) } },
      select: orgSelect,
      orderBy: { createdAt: "asc" },
    });

    return orgs.map(toOrganizationRef);
  }

  async organization(tx: Transaction, tenantId: TenantId): Promise<OrganizationRef | null> {
    const row = await prismaTx(tx).organization.findUnique({
      where: { id: tenantId },
      select: orgSelect,
    });

    return row && toOrganizationRef(row);
  }

  async recordAdvance(tx: Transaction, ctx: TenantContext, advance: TimeAdvance): Promise<void> {
    await prismaTx(tx).sandboxTimeAdvance.create({
      data: {
        id: advance.id,
        tenantId: ctx.tenantId,
        fromTime: toDate(advance.from),
        toTime: toDate(advance.to),
        actor: advance.actor as Prisma.InputJsonValue,
        fired: advance.fired as unknown as Prisma.InputJsonValue,
        createdAt: toDate(advance.createdAt),
      },
    });
  }

  async advances(tx: Transaction, ctx: TenantContext, limit: number): Promise<TimeAdvance[]> {
    const rows = await prismaTx(tx).sandboxTimeAdvance.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return rows.map((row) => ({
      id: row.id,
      from: toInstant(row.fromTime),
      to: toInstant(row.toTime),
      actor: row.actor,
      fired: row.fired as unknown as FiredTimer[],
      createdAt: toInstant(row.createdAt),
    }));
  }
}
