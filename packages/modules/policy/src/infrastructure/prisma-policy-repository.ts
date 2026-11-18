import { prismaTx } from "@pas/db";
import { type PolicyTermStatus as DbTermStatus, Prisma } from "@pas/db/client";
import { asId, type Jurisdiction, Money, type TenantContext, type Transaction } from "@pas/kernel";
import {
  type FinancialTransactionProps,
  Policy,
  type PolicyId,
  type PolicyTermId,
  type PolicyTransactionProps,
  type TermCancellation,
  type TermStatus,
} from "../domain/policy";
import type { PolicyEventProps } from "../domain/policy-event";
import type { PolicyScope } from "../domain/scope";
import { detailsFromJson, detailsToJson } from "./transaction-details";
import type { PolicyRepository } from "../ports/policy-repository";

const toDbStatus = (s: TermStatus) => s.toUpperCase() as DbTermStatus;
const fromDbStatus = (s: DbTermStatus) => s.toLowerCase() as TermStatus;
const toDate = (i: Temporal.Instant) => new Date(i.epochMilliseconds);
const toInstant = (d: Date) => Temporal.Instant.fromEpochMilliseconds(d.getTime());
const dateToDb = (d: Temporal.PlainDate) => new Date(`${d.toString()}T00:00:00Z`);
const dateFromDb = (d: Date) => Temporal.PlainDate.from(d.toISOString().slice(0, 10));
const money = (amount: Prisma.Decimal, currency: string) => Money.of(amount.toString(), currency);

function scoped(ctx: TenantContext, scope: PolicyScope): Prisma.PolicyWhereInput {
  switch (scope.kind) {
    case "producer":
      return { tenantId: ctx.tenantId, producerId: scope.producerId };
    case "party":
      return { tenantId: ctx.tenantId, id: { in: [...scope.policyIds] } };
    case "tenant":
      return { tenantId: ctx.tenantId };
  }
}

export class PrismaPolicyRepository implements PolicyRepository {
  async save(tx: Transaction, policy: Policy): Promise<void> {
    const db = prismaTx(tx);
    const { policy: p, terms } = policy.toSnapshot();
    const added = policy.pullAdded();

    await db.policy.upsert({
      where: { id: p.id },
      update: { insuredName: p.insuredName },
      create: {
        id: p.id,
        tenantId: p.tenantId,
        number: p.number,
        productId: p.productId,
        productName: p.productName,
        insuredName: p.insuredName,
        producerId: p.producer.id,
        producerName: p.producer.name,
        sourceSubmissionId: p.sourceSubmissionId,
        sourceQuoteId: p.sourceQuoteId,
        createdAt: toDate(p.createdAt),
      },
    });

    for (const term of terms) {
      const data = {
        status: toDbStatus(term.status),
        activatedAt: term.activatedAt ? toDate(term.activatedAt) : null,
        cancellation: term.cancellation
          ? ({
              ...term.cancellation,
              effectiveDate: term.cancellation.effectiveDate.toString(),
            } as Prisma.InputJsonValue)
          : Prisma.DbNull,
        writtenPremium: term.writtenPremium.toString(),
        taxesAndFees: term.taxesAndFees.toString(),
        updatedAt: toDate(term.updatedAt),
      };

      await db.policyTerm.upsert({
        where: { id: term.id },
        update: data,
        create: {
          ...data,
          id: term.id,
          tenantId: p.tenantId,
          policyId: p.id,
          termNumber: term.termNumber,
          productReleaseId: term.productReleaseId,
          productVersion: term.productVersion,
          country: term.jurisdiction.country,
          subdivision: term.jurisdiction.subdivision ?? null,
          effectiveDate: dateToDb(term.effectiveDate),
          expirationDate: dateToDb(term.expirationDate),
          currency: term.writtenPremium.currency,
          boundAt: toDate(term.boundAt),
        },
      });
    }

    const base = { tenantId: p.tenantId, policyId: p.id };

    if (added.transactions.length > 0) {
      await db.policyTransaction.createMany({
        data: added.transactions.map((t) => ({
          ...base,
          ...transactionRow(t),
          id: t.id,
          termId: t.termId,
          type: t.type,
          currency: t.premiumDelta.currency,
          createdBy: (t.createdBy ?? undefined) as Prisma.InputJsonValue | undefined,
          createdAt: toDate(t.createdAt),
          recordedAt: toDate(t.createdAt),
        })),
      });
    }

    for (const t of added.touched) {
      const { count } = await db.policyTransaction.updateMany({
        where: { id: t.id, tenantId: p.tenantId, status: { not: "issued" } },
        data: transactionRow(t),
      });

      if (count !== 1) throw new Error(`Transaction ${t.id} is issued and can't change`);
    }

    if (added.versions.length > 0) {
      await db.termVersion.createMany({
        data: added.versions.map((v) => ({
          tenantId: p.tenantId,
          id: v.id,
          termId: v.termId,
          transactionId: v.transactionId,
          version: v.version,
          effectiveDate: dateToDb(v.effectiveDate),
          snapshot: v.snapshot as Prisma.InputJsonValue,
          recordedAt: toDate(v.recordedAt),
        })),
      });
    }

    if (added.financials.length > 0) {
      await db.financialTransaction.createMany({
        data: added.financials.map((f) => ({
          ...base,
          id: f.id,
          termId: f.termId,
          transactionId: f.transactionId,
          kind: f.kind,
          code: f.code,
          label: f.label,
          coverage: f.coverage ?? null,
          exposure: f.exposure ?? null,
          remitter: f.remitter ?? null,
          amount: f.amount.toString(),
          currency: f.amount.currency,
          effectiveDate: dateToDb(f.effectiveDate),
          recordedAt: toDate(f.recordedAt),
        })),
      });
    }

    if (added.events.length > 0) {
      await db.policyEvent.createMany({
        data: added.events.map((e) => eventRow(p.tenantId, p.id, e)),
      });
    }

    if (added.documents.length > 0) {
      await db.policyDocument.createMany({
        data: added.documents.map((d) => ({
          ...base,
          id: d.id,
          transactionId: d.transactionId,
          kind: d.kind,
          title: d.title,
          storageKey: d.storageKey,
          sizeBytes: d.sizeBytes,
          createdAt: toDate(d.createdAt),
        })),
      });
    }
  }

  async appendEvent(
    tx: Transaction,
    ctx: TenantContext,
    policyId: PolicyId,
    event: PolicyEventProps,
  ): Promise<void> {
    await prismaTx(tx).policyEvent.create({ data: eventRow(ctx.tenantId, policyId, event) });
  }

  async findById(
    tx: Transaction,
    ctx: TenantContext,
    scope: PolicyScope,
    id: PolicyId,
  ): Promise<Policy | null> {
    return this.findOne(tx, { ...scoped(ctx, scope), id });
  }

  async findByQuote(tx: Transaction, ctx: TenantContext, quoteId: string): Promise<Policy | null> {
    return this.findOne(tx, { tenantId: ctx.tenantId, sourceQuoteId: quoteId });
  }

  async findByTerm(
    tx: Transaction,
    ctx: TenantContext,
    termId: PolicyTermId,
  ): Promise<Policy | null> {
    const term = await prismaTx(tx).policyTerm.findFirst({
      where: { tenantId: ctx.tenantId, id: termId },
      select: { policyId: true },
    });

    return term ? this.findOne(tx, { tenantId: ctx.tenantId, id: term.policyId }) : null;
  }

  async list(
    tx: Transaction,
    ctx: TenantContext,
    scope: PolicyScope,
    options: { limit: number },
  ): Promise<Policy[]> {
    const ids = await prismaTx(tx).policy.findMany({
      where: scoped(ctx, scope),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: options.limit,
      select: { id: true },
    });

    return this.load(
      tx,
      ctx,
      ids.map((row) => row.id),
    );
  }

  async nextSequence(tx: Transaction, ctx: TenantContext): Promise<number> {
    const [row] = await prismaTx(tx).$queryRaw<{ last_value: number }[]>`
      insert into policy_sequences (tenant_id, last_value) values (${ctx.tenantId}, 1)
      on conflict (tenant_id) do update set last_value = policy_sequences.last_value + 1
      returning last_value`;

    if (!row) throw new Error("Policy sequence returned no row");

    return Number(row.last_value);
  }

  private async findOne(tx: Transaction, where: Prisma.PolicyWhereInput): Promise<Policy | null> {
    const row = await prismaTx(tx).policy.findFirst({
      where,
      select: { id: true, tenantId: true },
    });

    if (!row) return null;

    const [policy] = await this.load(tx, { tenantId: asId(row.tenantId) }, [row.id]);

    return policy ?? null;
  }

  private async load(
    tx: Transaction,
    ctx: Pick<TenantContext, "tenantId">,
    ids: string[],
  ): Promise<Policy[]> {
    if (ids.length === 0) return [];

    const db = prismaTx(tx);
    const where = { tenantId: ctx.tenantId, policyId: { in: ids } };

    const [policies, terms, transactions, financials, documents, events] = await Promise.all([
      db.policy.findMany({
        where: { tenantId: ctx.tenantId, id: { in: ids } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
      db.policyTerm.findMany({ where, orderBy: { termNumber: "asc" } }),
      db.policyTransaction.findMany({ where, orderBy: { recordedAt: "asc" } }),
      db.financialTransaction.findMany({ where, orderBy: { recordedAt: "asc" } }),
      db.policyDocument.findMany({ where, orderBy: { createdAt: "asc" } }),
      db.policyEvent.findMany({ where, orderBy: [{ occurredAt: "asc" }, { id: "asc" }] }),
    ]);

    const versions = await db.termVersion.findMany({
      where: { tenantId: ctx.tenantId, termId: { in: terms.map((t) => t.id) } },
      orderBy: { version: "asc" },
    });

    return policies.map((p) => {
      const ownTerms = terms.filter((t) => t.policyId === p.id);
      const termIds = new Set(ownTerms.map((t) => t.id));

      return Policy.restore({
        policy: {
          id: asId(p.id),
          tenantId: asId(p.tenantId),
          number: p.number,
          productId: p.productId,
          productName: p.productName,
          insuredName: p.insuredName,
          producer: { id: p.producerId, name: p.producerName },
          sourceSubmissionId: p.sourceSubmissionId,
          sourceQuoteId: p.sourceQuoteId,
          createdAt: toInstant(p.createdAt),
        },
        terms: ownTerms.map((t) => ({
          id: asId(t.id),
          termNumber: t.termNumber,
          productReleaseId: t.productReleaseId,
          productVersion: t.productVersion,
          jurisdiction: (t.subdivision
            ? { country: t.country, subdivision: t.subdivision }
            : { country: t.country }) as Jurisdiction,
          effectiveDate: dateFromDb(t.effectiveDate),
          expirationDate: dateFromDb(t.expirationDate),
          status: fromDbStatus(t.status),
          writtenPremium: money(t.writtenPremium, t.currency),
          taxesAndFees: money(t.taxesAndFees, t.currency),
          boundAt: toInstant(t.boundAt),
          activatedAt: t.activatedAt ? toInstant(t.activatedAt) : null,
          cancellation: cancellationFromJson(t.cancellation),
          updatedAt: toInstant(t.updatedAt),
        })),
        transactions: transactions
          .filter((t) => t.policyId === p.id)
          .map((t): PolicyTransactionProps => ({
            id: t.id,
            termId: asId(t.termId),
            type: t.type as PolicyTransactionProps["type"],
            status: t.status as PolicyTransactionProps["status"],
            effectiveDate: dateFromDb(t.effectiveDate),
            premiumDelta: money(t.premiumDelta, t.currency),
            baseVersion: t.baseVersion,
            details: detailsFromJson(t.details),
            createdBy: (t.createdBy as unknown as PolicyTransactionProps["createdBy"]) ?? null,
            createdAt: toInstant(t.createdAt),
            updatedAt: toInstant(t.updatedAt),
            issuedAt: t.issuedAt ? toInstant(t.issuedAt) : null,
          })),
        versions: versions
          .filter((v) => termIds.has(v.termId))
          .map((v) => ({
            id: v.id,
            termId: asId(v.termId),
            transactionId: v.transactionId,
            version: v.version,
            effectiveDate: dateFromDb(v.effectiveDate),
            snapshot: v.snapshot as Record<string, unknown>,
            recordedAt: toInstant(v.recordedAt),
          })),
        financials: financials
          .filter((f) => f.policyId === p.id)
          .map((f): FinancialTransactionProps => ({
            id: f.id,
            termId: asId(f.termId),
            transactionId: f.transactionId,
            kind: f.kind as FinancialTransactionProps["kind"],
            code: f.code,
            label: f.label,
            ...(f.coverage && { coverage: f.coverage }),
            ...(f.exposure && { exposure: f.exposure }),
            ...(f.remitter && { remitter: f.remitter }),
            amount: money(f.amount, f.currency),
            effectiveDate: dateFromDb(f.effectiveDate),
            recordedAt: toInstant(f.recordedAt),
          })),
        documents: documents
          .filter((d) => d.policyId === p.id)
          .map((d) => ({
            id: d.id,
            transactionId: d.transactionId,
            kind: d.kind,
            title: d.title,
            storageKey: d.storageKey,
            sizeBytes: d.sizeBytes,
            createdAt: toInstant(d.createdAt),
          })),
        events: events
          .filter((e) => e.policyId === p.id)
          .map((e): PolicyEventProps => ({
            id: e.id,
            termId: e.termId,
            transactionId: e.transactionId,
            invoiceId: e.invoiceId,
            type: e.type as PolicyEventProps["type"],
            category: e.category as PolicyEventProps["category"],
            occurredAt: toInstant(e.occurredAt),
            effectiveDate: e.effectiveDate ? dateFromDb(e.effectiveDate) : null,
            actor: e.actor as unknown as PolicyEventProps["actor"],
            summary: e.summary,
            data: e.data as Record<string, unknown>,
          })),
      });
    });
  }
}

function transactionRow(t: PolicyTransactionProps) {
  return {
    status: t.status,
    effectiveDate: dateToDb(t.effectiveDate),
    premiumDelta: t.premiumDelta.toString(),
    baseVersion: t.baseVersion,
    details: detailsToJson(t.details) ?? Prisma.DbNull,
    updatedAt: toDate(t.updatedAt),
    issuedAt: t.issuedAt ? toDate(t.issuedAt) : null,
  };
}

function cancellationFromJson(value: unknown): TermCancellation | null {
  if (!value || typeof value !== "object") return null;

  const json = value as Omit<TermCancellation, "effectiveDate"> & { effectiveDate: string };

  return { ...json, effectiveDate: Temporal.PlainDate.from(json.effectiveDate) };
}

function eventRow(tenantId: string, policyId: string, e: PolicyEventProps) {
  return {
    id: e.id,
    tenantId,
    policyId,
    termId: e.termId,
    transactionId: e.transactionId,
    invoiceId: e.invoiceId,
    type: e.type,
    category: e.category,
    occurredAt: toDate(e.occurredAt),
    effectiveDate: e.effectiveDate ? dateToDb(e.effectiveDate) : null,
    actor: e.actor as unknown as Prisma.InputJsonValue,
    summary: e.summary,
    data: e.data as Prisma.InputJsonValue,
    recordedAt: new Date(),
  };
}
