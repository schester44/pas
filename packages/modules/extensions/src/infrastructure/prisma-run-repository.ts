import { instantFromDb, instantToDb, jsonToDb, prismaTx } from "@pas/db";
import {
  Prisma as PrismaRuntime,
  type ExtensionRun as Row,
  type PrismaClient,
} from "@pas/db/client";
import type { ExtensionPoint } from "@pas/extension-points";
import { asId, type Instant, type TenantContext, type Transaction } from "@pas/kernel";
import type { ExtensionRun, ExtensionRunId, RunStatus, RunTrigger } from "../domain/run";
import type { ExtensionRunRepository, RunFilter } from "../ports/repositories";

type ListedRow = Omit<Row, "input" | "output" | "network" | "logs"> &
  Partial<Pick<Row, "input" | "output" | "network" | "logs">>;

const toRun = (row: ListedRow): ExtensionRun => ({
  id: asId(row.id),
  tenantId: asId(row.tenantId),
  extensionId: asId(row.extensionId),
  extensionVersionId: row.extensionVersionId ? asId(row.extensionVersionId) : null,
  version: row.version,
  point: row.point as ExtensionPoint,
  trigger: row.trigger as RunTrigger,
  subject: row.subjectType && row.subjectId ? { type: row.subjectType, id: row.subjectId } : null,
  status: row.status as RunStatus,
  error: row.errorCode ? { code: row.errorCode, message: row.errorMessage ?? "" } : null,
  input: row.input ?? null,
  output: row.output ?? null,
  network: (row.network ?? []) as unknown as ExtensionRun["network"],
  logs: (row.logs ?? []) as unknown as ExtensionRun["logs"],
  stats: row.stats as unknown as ExtensionRun["stats"],
  createdAt: instantFromDb(row.createdAt),
});

export class PrismaExtensionRunRepository implements ExtensionRunRepository {
  async insert(tx: Transaction, run: ExtensionRun): Promise<void> {
    await prismaTx(tx).extensionRun.create({
      data: {
        id: run.id,
        tenantId: run.tenantId,
        extensionId: run.extensionId,
        extensionVersionId: run.extensionVersionId,
        version: run.version,
        point: run.point,
        trigger: run.trigger,
        subjectType: run.subject?.type ?? null,
        subjectId: run.subject?.id ?? null,
        status: run.status,
        errorCode: run.error?.code ?? null,
        errorMessage: run.error?.message ?? null,
        input: jsonToDb(run.input),
        output: run.output === null ? PrismaRuntime.DbNull : jsonToDb(run.output),
        network: jsonToDb(run.network),
        logs: jsonToDb(run.logs),
        stats: jsonToDb(run.stats),
        createdAt: instantToDb(run.createdAt),
      },
    });
  }

  async find(tx: Transaction, ctx: TenantContext, id: ExtensionRunId) {
    const row = await prismaTx(tx).extensionRun.findFirst({
      where: { id, tenantId: ctx.tenantId },
    });

    return row ? toRun(row) : null;
  }

  async list(tx: Transaction, ctx: TenantContext, filter: RunFilter) {
    const rows = await prismaTx(tx).extensionRun.findMany({
      where: {
        tenantId: ctx.tenantId,
        ...(filter.extensionId && { extensionId: filter.extensionId }),
        ...(filter.subject && { subjectType: filter.subject.type, subjectId: filter.subject.id }),
        ...(filter.status && { status: filter.status }),
        ...(filter.before && { createdAt: { lt: instantToDb(filter.before) } }),
      },
      omit: { input: true, output: true, network: true, logs: true },
      orderBy: { createdAt: "desc" },
      take: filter.limit,
    });

    return rows.map(toRun);
  }
}

/** Platform maintenance: deletes runs older than the retention period across every tenant. */
export async function purgeExtensionRuns(prisma: PrismaClient, before: Instant): Promise<number> {
  const { count } = await prisma.extensionRun.deleteMany({
    where: { createdAt: { lt: instantToDb(before) } },
  });

  return count;
}
