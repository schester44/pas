import { instantFromDb, instantToDb, prismaTx } from "@pas/db";
import type { ClientAccount as Row, Prisma } from "@pas/db/client";
import { asId, type TenantContext, type Transaction } from "@pas/kernel";
import {
  ClientAccount,
  type ClientAccountId,
  type ClientEmail,
  type ClientPhone,
} from "../domain/client-account";
import { addressKey, type ContactKeys, nameKey, type PostalAddress } from "../domain/contact";
import type { ClientAccountRepository } from "../ports/client-account-repository";

type EmailJson = { address: string; key: string; verifiedAt: string | null };

function restore(row: Row): ClientAccount {
  return ClientAccount.restore({
    id: asId(row.id),
    tenantId: asId(row.tenantId),
    kind: row.kind as "person" | "business",
    displayName: row.displayName,
    firstName: row.firstName,
    lastName: row.lastName,
    businessName: row.businessName,
    emails: (row.emails as EmailJson[]).map((e): ClientEmail => ({
      ...e,
      verifiedAt: e.verifiedAt ? Temporal.Instant.from(e.verifiedAt) : null,
    })),
    phones: row.phones as unknown as ClientPhone[],
    mailingAddress: (row.mailingAddress as PostalAddress | null) ?? null,
    status: row.status as "active" | "merged",
    mergedIntoId: row.mergedIntoId ? asId(row.mergedIntoId) : null,
    invitedAt: row.invitedAt ? instantFromDb(row.invitedAt) : null,
    createdAt: instantFromDb(row.createdAt),
    updatedAt: instantFromDb(row.updatedAt),
  });
}

export class PrismaClientAccountRepository implements ClientAccountRepository {
  async save(tx: Transaction, account: ClientAccount): Promise<void> {
    const a = account.toSnapshot();

    const data = {
      kind: a.kind,
      displayName: a.displayName,
      firstName: a.firstName,
      lastName: a.lastName,
      businessName: a.businessName,
      emails: a.emails.map((e) => ({
        ...e,
        verifiedAt: e.verifiedAt?.toString() ?? null,
      })) as Prisma.InputJsonValue,
      phones: a.phones as unknown as Prisma.InputJsonValue,
      mailingAddress: (a.mailingAddress ?? undefined) as Prisma.InputJsonValue | undefined,
      nameKey: nameKey(a.displayName, a.kind),
      emailKeys: a.emails.map((e) => e.key),
      phoneKeys: a.phones.map((p) => p.key),
      addressKey: addressKey(a.mailingAddress),
      status: a.status,
      mergedIntoId: a.mergedIntoId,
      invitedAt: a.invitedAt ? instantToDb(a.invitedAt) : null,
      updatedAt: instantToDb(a.updatedAt),
    };

    await prismaTx(tx).clientAccount.upsert({
      where: { id: a.id },
      update: data,
      create: { ...data, id: a.id, tenantId: a.tenantId, createdAt: instantToDb(a.createdAt) },
    });
  }

  async findById(
    tx: Transaction,
    ctx: TenantContext,
    id: ClientAccountId,
  ): Promise<ClientAccount | null> {
    const row = await prismaTx(tx).clientAccount.findFirst({
      where: { tenantId: ctx.tenantId, id },
    });

    return row ? restore(row) : null;
  }

  async findByIds(
    tx: Transaction,
    ctx: TenantContext,
    ids: readonly string[],
  ): Promise<ClientAccount[]> {
    if (ids.length === 0) return [];

    const rows = await prismaTx(tx).clientAccount.findMany({
      where: { tenantId: ctx.tenantId, id: { in: [...ids] } },
      orderBy: { createdAt: "asc" },
    });

    return rows.map(restore);
  }

  async findCandidates(
    tx: Transaction,
    ctx: TenantContext,
    keys: ContactKeys,
  ): Promise<ClientAccount[]> {
    const or: Prisma.ClientAccountWhereInput[] = [
      ...(keys.emailKeys.length > 0 ? [{ emailKeys: { hasSome: [...keys.emailKeys] } }] : []),
      ...(keys.nameKey ? [{ nameKey: keys.nameKey }] : []),
    ];

    if (or.length === 0) return [];

    const rows = await prismaTx(tx).clientAccount.findMany({
      where: { tenantId: ctx.tenantId, status: "active", OR: or },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 50,
    });

    return rows.map(restore);
  }

  async findByEmailKey(tx: Transaction, ctx: TenantContext, key: string): Promise<ClientAccount[]> {
    const rows = await prismaTx(tx).clientAccount.findMany({
      where: { tenantId: ctx.tenantId, status: "active", emailKeys: { has: key } },
      orderBy: { createdAt: "asc" },
    });

    return rows.map(restore);
  }

  async search(
    tx: Transaction,
    ctx: TenantContext,
    options: { query: string; limit: number },
  ): Promise<ClientAccount[]> {
    const q = options.query.toLowerCase();

    const rows = await prismaTx(tx).clientAccount.findMany({
      where: {
        tenantId: ctx.tenantId,
        status: "active",
        ...(q && {
          OR: [
            { displayName: { contains: q, mode: "insensitive" } },
            { emailKeys: { has: q } },
            { nameKey: { contains: q } },
          ],
        }),
      },
      orderBy: [{ displayName: "asc" }, { createdAt: "asc" }],
      take: options.limit,
    });

    return rows.map(restore);
  }
}
