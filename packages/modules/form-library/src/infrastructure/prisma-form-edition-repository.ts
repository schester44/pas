import { instantFromDb, instantToDb, prismaTx } from "@pas/db";
import type { FormEdition as FormEditionRow } from "@pas/db/client";
import { asId, type TenantContext, type Transaction } from "@pas/kernel";
import { type Edition, editionFromKey, editionKey } from "../domain/edition";
import { FormEdition, type FormEditionId } from "../domain/form-edition";
import type { FormEditionRepository } from "../ports/form-edition-repository";

export class PrismaFormEditionRepository implements FormEditionRepository {
  async insert(tx: Transaction, edition: FormEdition): Promise<void> {
    const e = edition.toSnapshot();

    await prismaTx(tx).formEdition.create({
      data: {
        id: e.id,
        tenantId: e.tenantId,
        formNumber: e.formNumber,
        edition: editionKey(e.edition),
        title: e.title,
        jurisdictions: e.jurisdictions,
        carrier: e.carrier,
        storageKey: e.file.storageKey,
        contentSha256: e.file.sha256,
        pageCount: e.file.pageCount,
        sizeBytes: e.file.sizeBytes,
        createdBy: e.createdBy,
        createdAt: instantToDb(e.createdAt),
      },
    });
  }

  async findById(
    tx: Transaction,
    ctx: TenantContext,
    id: FormEditionId,
  ): Promise<FormEdition | null> {
    const row = await prismaTx(tx).formEdition.findFirst({ where: { id, tenantId: ctx.tenantId } });

    return row ? toEdition(row) : null;
  }

  async list(tx: Transaction, ctx: TenantContext): Promise<FormEdition[]> {
    const rows = await prismaTx(tx).formEdition.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: [{ formNumber: "asc" }, { edition: "desc" }],
    });

    return rows.map(toEdition);
  }

  async exists(
    tx: Transaction,
    ctx: TenantContext,
    formNumber: string,
    edition: Edition,
  ): Promise<boolean> {
    const row = await prismaTx(tx).formEdition.findFirst({
      where: { tenantId: ctx.tenantId, formNumber, edition: editionKey(edition) },
      select: { id: true },
    });

    return row !== null;
  }

  async existingIds(
    tx: Transaction,
    ctx: TenantContext,
    ids: readonly string[],
  ): Promise<Set<string>> {
    const valid = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));

    const rows = await prismaTx(tx).formEdition.findMany({
      where: { tenantId: ctx.tenantId, id: { in: valid } },
      select: { id: true },
    });

    return new Set(rows.map((row) => row.id));
  }
}

function toEdition(row: FormEditionRow): FormEdition {
  return FormEdition.restore({
    id: asId(row.id),
    tenantId: asId(row.tenantId),
    formNumber: row.formNumber,
    edition: editionFromKey(row.edition),
    title: row.title,
    jurisdictions: row.jurisdictions,
    carrier: row.carrier,
    file: {
      storageKey: row.storageKey,
      sha256: row.contentSha256,
      pageCount: row.pageCount,
      sizeBytes: row.sizeBytes,
    },
    createdBy: row.createdBy,
    createdAt: instantFromDb(row.createdAt),
  });
}
