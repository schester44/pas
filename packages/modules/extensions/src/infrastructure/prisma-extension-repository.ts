import { instantFromDb, instantToDb, jsonToDb, prismaTx } from "@pas/db";
import type {
  Extension as ExtensionRow,
  ExtensionVersion as ExtensionVersionRow,
} from "@pas/db/client";
import { asId, type Instant, newId, type TenantContext, type Transaction } from "@pas/kernel";
import {
  Extension,
  type ExtensionDraft,
  type ExtensionId,
  type ExtensionStatus,
} from "../domain/extension";
import { emptyManifest, type ExtensionManifest } from "../domain/manifest";
import type { SealedSecret, StoredSecret } from "../domain/secret";
import type { ExtensionTest, TestReport } from "../domain/test-case";
import type { ExtensionVersion, ExtensionVersionId } from "../domain/version";
import type { ExtensionRepository } from "../ports/repositories";

const manifestOf = (value: unknown): ExtensionManifest => ({
  ...emptyManifest(),
  ...(value as Partial<ExtensionManifest>),
});

function toExtension(row: ExtensionRow): Extension {
  const draft = row.draft as unknown as Partial<ExtensionDraft>;

  return Extension.restore({
    id: asId(row.id),
    tenantId: asId(row.tenantId),
    key: row.key,
    name: row.name,
    description: row.description,
    status: row.status as ExtensionStatus,
    draft: {
      files: draft.files ?? {},
      manifest: manifestOf(draft.manifest),
      tests: draft.tests ?? [],
    },
    latestVersion: row.latestVersion,
    createdAt: instantFromDb(row.createdAt),
    updatedAt: instantFromDb(row.updatedAt),
  });
}

function toVersion(
  row: Omit<ExtensionVersionRow, "code" | "source"> & { code?: string; source?: unknown },
) {
  return {
    id: asId<"ExtensionVersion">(row.id),
    tenantId: asId(row.tenantId),
    extensionId: asId<"Extension">(row.extensionId),
    version: row.version,
    code: row.code ?? "",
    source: (row.source ?? {}) as Record<string, string>,
    manifest: manifestOf(row.manifest),
    tests: row.tests as unknown as ExtensionTest[],
    contentHash: row.contentHash,
    testReport: row.testReport as unknown as TestReport,
    note: row.note,
    publishedAt: instantFromDb(row.publishedAt),
  } satisfies ExtensionVersion;
}

export class PrismaExtensionRepository implements ExtensionRepository {
  async save(tx: Transaction, extension: Extension): Promise<void> {
    const e = extension.toSnapshot();

    const data = {
      name: e.name,
      description: e.description,
      status: e.status,
      draft: jsonToDb(e.draft),
      latestVersion: e.latestVersion,
      updatedAt: instantToDb(e.updatedAt),
    };

    await prismaTx(tx).extension.upsert({
      where: { id: e.id },
      create: {
        id: e.id,
        tenantId: e.tenantId,
        key: e.key,
        createdAt: instantToDb(e.createdAt),
        ...data,
      },
      update: data,
    });
  }

  async findById(tx: Transaction, ctx: TenantContext, id: ExtensionId) {
    const row = await prismaTx(tx).extension.findFirst({ where: { id, tenantId: ctx.tenantId } });

    return row ? toExtension(row) : null;
  }

  async findByKey(tx: Transaction, ctx: TenantContext, key: string) {
    const row = await prismaTx(tx).extension.findFirst({ where: { key, tenantId: ctx.tenantId } });

    return row ? toExtension(row) : null;
  }

  async list(tx: Transaction, ctx: TenantContext) {
    const rows = await prismaTx(tx).extension.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { name: "asc" },
    });

    return rows.map(toExtension);
  }

  async insertVersion(tx: Transaction, version: ExtensionVersion): Promise<void> {
    await prismaTx(tx).extensionVersion.create({
      data: {
        id: version.id,
        tenantId: version.tenantId,
        extensionId: version.extensionId,
        version: version.version,
        code: version.code,
        source: jsonToDb(version.source),
        manifest: jsonToDb(version.manifest),
        tests: jsonToDb(version.tests),
        contentHash: version.contentHash,
        testReport: jsonToDb(version.testReport),
        note: version.note,
        publishedAt: instantToDb(version.publishedAt),
      },
    });
  }

  async findVersion(tx: Transaction, ctx: TenantContext, id: ExtensionVersionId) {
    const row = await prismaTx(tx).extensionVersion.findFirst({
      where: { id, tenantId: ctx.tenantId },
    });

    return row ? toVersion(row) : null;
  }

  async findVersions(tx: Transaction, ctx: TenantContext, ids: readonly ExtensionVersionId[]) {
    if (ids.length === 0) return [];

    const rows = await prismaTx(tx).extensionVersion.findMany({
      where: { tenantId: ctx.tenantId, id: { in: [...ids] } },
      omit: { code: true, source: true },
    });

    return rows.map(toVersion);
  }

  async versions(tx: Transaction, ctx: TenantContext, extensionId: ExtensionId) {
    const rows = await prismaTx(tx).extensionVersion.findMany({
      where: { tenantId: ctx.tenantId, extensionId },
      omit: { code: true, source: true },
      orderBy: { version: "desc" },
    });

    return rows.map(toVersion);
  }

  async publishedVersions(tx: Transaction, ctx: TenantContext) {
    const rows = await prismaTx(tx).extensionVersion.findMany({
      where: { tenantId: ctx.tenantId },
      omit: { code: true, source: true, tests: true },
      orderBy: [{ publishedAt: "desc" }],
    });

    return rows.map((row) => toVersion({ ...row, tests: [] }));
  }

  async secrets(
    tx: Transaction,
    ctx: TenantContext,
    extensionId: ExtensionId,
  ): Promise<StoredSecret[]> {
    const rows = await prismaTx(tx).extensionSecret.findMany({
      where: { tenantId: ctx.tenantId, extensionId },
      orderBy: { name: "asc" },
    });

    return rows.map((row) => ({
      name: row.name,
      sealed: row.sealed as unknown as SealedSecret,
      hint: row.hint,
      updatedAt: instantFromDb(row.updatedAt).toString(),
    }));
  }

  async putSecret(
    tx: Transaction,
    ctx: TenantContext,
    input: {
      extensionId: ExtensionId;
      name: string;
      sealed: SealedSecret;
      hint: string;
      at: Instant;
    },
  ): Promise<void> {
    const data = {
      sealed: jsonToDb(input.sealed),
      hint: input.hint,
      updatedAt: instantToDb(input.at),
    };

    await prismaTx(tx).extensionSecret.upsert({
      where: {
        tenantId_extensionId_name: {
          tenantId: ctx.tenantId,
          extensionId: input.extensionId,
          name: input.name,
        },
      },
      create: {
        id: newId(),
        tenantId: ctx.tenantId,
        extensionId: input.extensionId,
        name: input.name,
        ...data,
      },
      update: data,
    });
  }

  async deleteSecret(
    tx: Transaction,
    ctx: TenantContext,
    input: { extensionId: ExtensionId; name: string },
  ): Promise<void> {
    await prismaTx(tx).extensionSecret.deleteMany({
      where: { tenantId: ctx.tenantId, extensionId: input.extensionId, name: input.name },
    });
  }
}
