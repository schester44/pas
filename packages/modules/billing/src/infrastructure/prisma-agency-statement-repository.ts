import { prismaTx } from "@pas/db";
import type {
  AgencyStatement as StatementRow,
  AgencyStatementItem as ItemRow,
  Prisma,
} from "@pas/db/client";
import { asId, Money, type PlainDate, type TenantContext, type Transaction } from "@pas/kernel";
import {
  AgencyStatement,
  type RemittanceBasis,
  type StatementItem,
  type StatementStatus,
} from "../domain/agency-statement";
import type { AgencyStatementRepository, StatementRef } from "../ports/agency-statement-repository";

const toDate = (i: Temporal.Instant) => new Date(i.epochMilliseconds);
const toInstant = (d: Date) => Temporal.Instant.fromEpochMilliseconds(d.getTime());
const dateToDb = (d: PlainDate) => new Date(`${d.toString()}T00:00:00Z`);
const dateFromDb = (d: Date) => Temporal.PlainDate.from(d.toISOString().slice(0, 10));
const money = (amount: Prisma.Decimal, currency: string) => Money.of(amount.toString(), currency);

const UNPAID = ["OPEN", "PAST_DUE", "PARTIALLY_PAID"] as const;

export class PrismaAgencyStatementRepository implements AgencyStatementRepository {
  async save(tx: Transaction, ctx: TenantContext, statement: AgencyStatement): Promise<void> {
    const db = prismaTx(tx);
    const s = statement.toSnapshot();

    const data = {
      status: s.status,
      remindedOn: s.remindedOn ? dateToDb(s.remindedOn) : null,
      suspendedOn: s.suspendedOn ? dateToDb(s.suspendedOn) : null,
      documentKey: s.documentKey,
      emailedTo: s.emailedTo,
      updatedAt: toDate(s.updatedAt),
    };

    await db.agencyStatement.upsert({
      where: { id: s.id },
      update: data,
      create: {
        ...data,
        id: s.id,
        tenantId: ctx.tenantId,
        agencyId: s.agencyId,
        agencyName: s.agencyName,
        number: s.number,
        periodStart: dateToDb(s.periodStart),
        periodEnd: dateToDb(s.periodEnd),
        issuedOn: dateToDb(s.issuedOn),
        dueOn: dateToDb(s.dueOn),
        remittanceBasis: s.remittanceBasis,
        currency: s.currency,
        createdAt: toDate(s.createdAt),
      },
    });

    for (const item of s.items) {
      const amounts = {
        credited: item.credited.toString(),
        paid: item.paid.toString(),
        settlementCredit: item.settlementCredit.toString(),
      };

      await db.agencyStatementItem.upsert({
        where: { id: item.id },
        update: amounts,
        create: {
          ...amounts,
          id: item.id,
          tenantId: ctx.tenantId,
          statementId: s.id,
          position: item.position,
          invoiceId: item.invoiceId,
          invoiceNumber: item.invoiceNumber,
          invoiceKind: item.invoiceKind,
          policyId: item.policyId,
          policyNumber: item.policyNumber,
          insuredName: item.insuredName,
          transactionId: item.transactionId,
          transactionType: item.transactionType,
          effectiveDate: dateToDb(item.effectiveDate),
          gross: item.gross.toString(),
          commission: item.commission.toString(),
          net: item.net.toString(),
          due: item.due.toString(),
        },
      });
    }
  }

  async findById(tx: Transaction, ctx: TenantContext, id: string) {
    return this.one(tx, { tenantId: ctx.tenantId, id });
  }

  async findByPeriod(tx: Transaction, ctx: TenantContext, agencyId: string, periodEnd: PlainDate) {
    return this.one(tx, { tenantId: ctx.tenantId, agencyId, periodEnd: dateToDb(periodEnd) });
  }

  async latestFor(tx: Transaction, ctx: TenantContext, agencyId: string) {
    const [latest] = await this.many(tx, { tenantId: ctx.tenantId, agencyId }, 1);

    return latest ?? null;
  }

  async list(
    tx: Transaction,
    ctx: TenantContext,
    filter: { agencyIds?: readonly string[]; statuses?: readonly StatementStatus[]; limit: number },
  ) {
    return this.many(
      tx,
      {
        tenantId: ctx.tenantId,
        ...(filter.agencyIds && { agencyId: { in: [...filter.agencyIds] } }),
        ...(filter.statuses && { status: { in: [...filter.statuses] } }),
      },
      filter.limit,
    );
  }

  async forInvoices(tx: Transaction, ctx: TenantContext, invoiceIds: readonly string[]) {
    const db = prismaTx(tx);

    const items = await db.agencyStatementItem.findMany({
      where: { tenantId: ctx.tenantId, invoiceId: { in: [...invoiceIds] } },
      select: { invoiceId: true, statementId: true },
    });

    const statements = await db.agencyStatement.findMany({
      where: { tenantId: ctx.tenantId, id: { in: [...new Set(items.map((i) => i.statementId))] } },
      select: { id: true, number: true, status: true, dueOn: true },
    });

    const byId = new Map(statements.map((s) => [s.id, s]));

    return new Map<string, StatementRef>(
      items.flatMap((item) => {
        const s = byId.get(item.statementId);

        return s
          ? [
              [
                item.invoiceId,
                {
                  statementId: s.id,
                  number: s.number,
                  status: s.status as StatementStatus,
                  dueOn: dateFromDb(s.dueOn),
                },
              ],
            ]
          : [];
      }),
    );
  }

  async nextSequence(tx: Transaction, ctx: TenantContext): Promise<number> {
    const row = await prismaTx(tx).agencyStatementSequence.upsert({
      where: { tenantId: ctx.tenantId },
      create: { tenantId: ctx.tenantId, lastValue: 1 },
      update: { lastValue: { increment: 1 } },
    });

    return row.lastValue;
  }

  async unstatemented(tx: Transaction, ctx: TenantContext, agencyId: string, through: PlainDate) {
    const db = prismaTx(tx);

    const invoices = await db.invoice.findMany({
      where: {
        tenantId: ctx.tenantId,
        payer: "agency",
        payerRef: agencyId,
        issuedOn: { lte: dateToDb(through) },
        status: { not: "VOID" },
      },
      select: { id: true },
      orderBy: { issuedOn: "asc" },
    });

    const carried = new Set(
      (
        await db.agencyStatementItem.findMany({
          where: { tenantId: ctx.tenantId, invoiceId: { in: invoices.map((i) => i.id) } },
          select: { invoiceId: true },
        })
      ).map((i) => i.invoiceId),
    );

    return invoices.map((i) => i.id).filter((id) => !carried.has(id));
  }

  async agencyBalance(tx: Transaction, ctx: TenantContext, agencyId: string, currency: string) {
    const rows = await prismaTx(tx).invoice.findMany({
      where: {
        tenantId: ctx.tenantId,
        payer: "agency",
        payerRef: agencyId,
        OR: [{ kind: "invoice", status: { in: [...UNPAID] } }, { kind: "credit_note" }],
      },
      select: { total: true, amountPaid: true, amountCredited: true, amountWrittenOff: true },
    });

    return rows.reduce(
      (sum, r) =>
        sum.plus(
          Money.of(r.total.toString(), currency)
            .minus(Money.of(r.amountPaid.toString(), currency))
            .minus(Money.of(r.amountCredited.toString(), currency))
            .minus(Money.of(r.amountWrittenOff.toString(), currency)),
        ),
      Money.zero(currency),
    );
  }

  private async one(tx: Transaction, where: Prisma.AgencyStatementWhereInput) {
    const [found] = await this.many(tx, where, 1);

    return found ?? null;
  }

  private async many(tx: Transaction, where: Prisma.AgencyStatementWhereInput, limit: number) {
    const db = prismaTx(tx);

    const rows = await db.agencyStatement.findMany({
      where,
      orderBy: [{ periodEnd: "desc" }, { createdAt: "desc" }],
      take: limit,
    });

    const items = await db.agencyStatementItem.findMany({
      where: { statementId: { in: rows.map((r) => r.id) } },
      orderBy: { position: "asc" },
    });

    return rows.map((row) =>
      toStatement(
        row,
        items.filter((i) => i.statementId === row.id),
      ),
    );
  }
}

function toItem(row: ItemRow, currency: string): StatementItem {
  const m = (value: Prisma.Decimal) => money(value, currency);

  return {
    id: row.id,
    position: row.position,
    invoiceId: row.invoiceId,
    invoiceNumber: row.invoiceNumber,
    invoiceKind: row.invoiceKind as StatementItem["invoiceKind"],
    policyId: row.policyId,
    policyNumber: row.policyNumber,
    insuredName: row.insuredName,
    transactionId: row.transactionId,
    transactionType: row.transactionType,
    effectiveDate: dateFromDb(row.effectiveDate),
    gross: m(row.gross),
    commission: m(row.commission),
    net: m(row.net),
    due: m(row.due),
    credited: m(row.credited),
    paid: m(row.paid),
    settlementCredit: m(row.settlementCredit),
  };
}

function toStatement(row: StatementRow, items: ItemRow[]): AgencyStatement {
  return AgencyStatement.restore({
    id: row.id,
    tenantId: asId(row.tenantId),
    agencyId: row.agencyId,
    agencyName: row.agencyName,
    number: row.number,
    periodStart: dateFromDb(row.periodStart),
    periodEnd: dateFromDb(row.periodEnd),
    issuedOn: dateFromDb(row.issuedOn),
    dueOn: dateFromDb(row.dueOn),
    remittanceBasis: row.remittanceBasis as RemittanceBasis,
    currency: row.currency,
    status: row.status as StatementStatus,
    items: items.map((i) => toItem(i, row.currency)),
    remindedOn: row.remindedOn ? dateFromDb(row.remindedOn) : null,
    suspendedOn: row.suspendedOn ? dateFromDb(row.suspendedOn) : null,
    documentKey: row.documentKey,
    emailedTo: row.emailedTo,
    createdAt: toInstant(row.createdAt),
    updatedAt: toInstant(row.updatedAt),
  });
}
