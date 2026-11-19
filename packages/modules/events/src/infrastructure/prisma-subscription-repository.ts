import { instantFromDb, instantToDb, prismaTx } from "@pas/db";
import { asId, type TenantContext, type Transaction } from "@pas/kernel";
import { Subscription, type SigningSecrets } from "../domain/subscription";
import type { SubscriptionRepository } from "../ports/subscription-repository";
import { json, maybeDate, maybeInstant } from "./mappers";

type StoredSecrets = {
  current: Record<string, string>;
  previous: { sealed: Record<string, string>; expiresAt: string } | null;
} | null;

type Row = Awaited<
  ReturnType<ReturnType<typeof prismaTx>["eventSubscription"]["findFirstOrThrow"]>
>;

function toDomain(row: Row): Subscription {
  const stored = row.secrets as StoredSecrets;

  const secrets: SigningSecrets | null = stored && {
    current: stored.current,
    previous: stored.previous && {
      sealed: stored.previous.sealed,
      expiresAt: Temporal.Instant.from(stored.previous.expiresAt),
    },
  };

  return Subscription.restore({
    id: row.id,
    tenantId: asId(row.tenantId),
    kind: row.kind as "webhook" | "chat",
    name: row.name,
    url: row.url,
    eventTypes: row.eventTypes,
    filter: row.filter,
    status: row.status as "active" | "disabled",
    disabledReason: row.disabledReason,
    secrets,
    secretHint: row.secretHint,
    failingSince: maybeInstant(row.failingSince),
    lastSuccessAt: maybeInstant(row.lastSuccessAt),
    createdBy: row.createdBy,
    createdAt: instantFromDb(row.createdAt),
    updatedAt: instantFromDb(row.updatedAt),
  });
}

export class PrismaSubscriptionRepository implements SubscriptionRepository {
  async list(tx: Transaction, ctx: TenantContext): Promise<Subscription[]> {
    const rows = await prismaTx(tx).eventSubscription.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { createdAt: "asc" },
    });

    return rows.map(toDomain);
  }

  async findById(tx: Transaction, ctx: TenantContext, id: string): Promise<Subscription | null> {
    const row = await prismaTx(tx).eventSubscription.findFirst({
      where: { tenantId: ctx.tenantId, id },
    });

    return row && toDomain(row);
  }

  async save(tx: Transaction, subscription: Subscription): Promise<void> {
    const s = subscription.toSnapshot();

    const secrets: StoredSecrets = s.secrets && {
      current: s.secrets.current,
      previous: s.secrets.previous && {
        sealed: s.secrets.previous.sealed,
        expiresAt: s.secrets.previous.expiresAt.toString(),
      },
    };

    const data = {
      kind: s.kind,
      name: s.name,
      url: s.url,
      eventTypes: s.eventTypes,
      filter: s.filter,
      status: s.status,
      disabledReason: s.disabledReason,
      secrets: json(secrets),
      secretHint: s.secretHint,
      failingSince: maybeDate(s.failingSince),
      lastSuccessAt: maybeDate(s.lastSuccessAt),
      updatedAt: instantToDb(s.updatedAt),
    };

    await prismaTx(tx).eventSubscription.upsert({
      where: { id: s.id },
      create: {
        id: s.id,
        tenantId: s.tenantId,
        createdBy: s.createdBy,
        createdAt: instantToDb(s.createdAt),
        ...data,
      },
      update: data,
    });
  }

  async delete(tx: Transaction, ctx: TenantContext, id: string): Promise<void> {
    await prismaTx(tx).eventSubscription.deleteMany({ where: { tenantId: ctx.tenantId, id } });
  }
}
