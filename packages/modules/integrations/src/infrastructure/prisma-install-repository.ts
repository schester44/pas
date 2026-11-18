import { type PrismaClient, prismaTx } from "@pas/db";
import { asId, type TenantContext, type TenantId, type Transaction } from "@pas/kernel";
import type { IntegrationCategory } from "../domain/category";
import { IntegrationInstall, type SealedSecret } from "../domain/install";
import type { InstallRepository } from "../ports/install-repository";
import { json, toDate, toInstant } from "./mappers";

type Row = NonNullable<Awaited<ReturnType<PrismaClient["integrationInstall"]["findFirst"]>>>;

function toInstall(row: Row): IntegrationInstall {
  return IntegrationInstall.restore({
    id: row.id,
    tenantId: asId(row.tenantId),
    providerId: row.providerId,
    category: row.category as IntegrationCategory,
    status: row.status,
    environment: row.environment,
    config: row.config as Record<string, unknown>,
    secrets: row.secrets as unknown as Record<string, SealedSecret>,
    secretHints: row.secretHints as Record<string, string>,
    position: row.position,
    health:
      row.lastCheckedAt && row.lastCheckOk !== null
        ? {
            checkedAt: toInstant(row.lastCheckedAt),
            ok: row.lastCheckOk,
            detail: row.lastCheckDetail ?? "",
          }
        : null,
    enabledAt: row.enabledAt && toInstant(row.enabledAt),
    createdAt: toInstant(row.createdAt),
    updatedAt: toInstant(row.updatedAt),
  });
}

export class PrismaInstallRepository implements InstallRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(tx: Transaction, ctx: TenantContext): Promise<IntegrationInstall[]> {
    const rows = await prismaTx(tx).integrationInstall.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { createdAt: "asc" },
    });

    return rows.map(toInstall);
  }

  async find(tx: Transaction, ctx: TenantContext, providerId: string) {
    const row = await prismaTx(tx).integrationInstall.findUnique({
      where: { tenantId_providerId: { tenantId: ctx.tenantId, providerId } },
    });

    return row && toInstall(row);
  }

  async findById(tx: Transaction, ctx: TenantContext, id: string) {
    const row = await prismaTx(tx).integrationInstall.findFirst({
      where: { tenantId: ctx.tenantId, id },
    });

    return row && toInstall(row);
  }

  async save(tx: Transaction, install: IntegrationInstall): Promise<void> {
    const i = install.toSnapshot();

    const data = {
      status: i.status,
      environment: i.environment,
      config: json(i.config),
      secrets: json(i.secrets),
      secretHints: json(i.secretHints),
      position: i.position,
      lastCheckedAt: i.health && toDate(i.health.checkedAt),
      lastCheckOk: i.health?.ok ?? null,
      lastCheckDetail: i.health?.detail ?? null,
      enabledAt: i.enabledAt && toDate(i.enabledAt),
      updatedAt: toDate(i.updatedAt),
    };

    await prismaTx(tx).integrationInstall.upsert({
      where: { id: i.id },
      create: {
        id: i.id,
        tenantId: i.tenantId,
        providerId: i.providerId,
        category: i.category,
        createdAt: toDate(i.createdAt),
        ...data,
      },
      update: data,
    });
  }

  async tenantOf(installId: string): Promise<TenantId | null> {
    if (!/^[0-9a-f-]{36}$/i.test(installId)) return null;

    const row = await this.prisma.$transaction(async (db) => {
      await db.$executeRaw`select set_config('app.platform_read', 'on', true)`;

      return db.integrationInstall.findUnique({
        where: { id: installId },
        select: { tenantId: true },
      });
    });

    return row ? asId(row.tenantId) : null;
  }
}
