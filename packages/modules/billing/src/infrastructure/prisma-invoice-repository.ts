import { prismaTx } from "@pas/db";
import type {
  InvoiceStatus as DbInvoiceStatus,
  Invoice as InvoiceRow,
  InvoiceLine as LineRow,
  Prisma,
} from "@pas/db/client";
import { asId, Money, newId, type TenantContext, type Transaction } from "@pas/kernel";
import {
  Invoice,
  type InvoiceId,
  type InvoiceProps,
  type InvoiceStatus,
  type PaymentProps,
} from "../domain/invoice";
import type { ChargeKind } from "../domain/invoice-lines";
import type { InvoiceRepository } from "../ports/invoice-repository";

const toDate = (i: Temporal.Instant) => new Date(i.epochMilliseconds);
const toInstant = (d: Date) => Temporal.Instant.fromEpochMilliseconds(d.getTime());
const dateToDb = (d: Temporal.PlainDate) => new Date(`${d.toString()}T00:00:00Z`);
const dateFromDb = (d: Date) => Temporal.PlainDate.from(d.toISOString().slice(0, 10));
const money = (amount: Prisma.Decimal, currency: string) => Money.of(amount.toString(), currency);

export class PrismaInvoiceRepository implements InvoiceRepository {
  async save(tx: Transaction, invoice: Invoice): Promise<void> {
    const db = prismaTx(tx);
    const i = invoice.toSnapshot();

    const data = {
      amountPaid: i.amountPaid.toString(),
      status: i.status.toUpperCase() as DbInvoiceStatus,
      updatedAt: toDate(i.updatedAt),
    };

    const existing = await db.invoice.findUnique({ where: { id: i.id }, select: { id: true } });

    if (existing) {
      await db.invoice.update({ where: { id: i.id }, data });

      return;
    }

    await db.invoice.create({
      data: {
        ...data,
        id: i.id,
        tenantId: i.tenantId,
        number: i.number,
        kind: i.kind,
        policyId: i.policyId,
        policyNumber: i.policyNumber,
        transactionId: i.transactionId,
        currency: i.total.currency,
        total: i.total.toString(),
        issuedOn: dateToDb(i.issuedOn),
        dueOn: dateToDb(i.dueOn),
        createdAt: toDate(i.createdAt),
      },
    });

    await db.invoiceLine.createMany({
      data: i.lines.map((line, position) => ({
        id: newId(),
        tenantId: i.tenantId,
        invoiceId: i.id,
        position,
        kind: line.kind,
        code: line.code,
        label: line.label,
        coverage: line.coverage ?? null,
        exposure: line.exposure ?? null,
        amount: line.amount.toString(),
      })),
    });
  }

  async findById(tx: Transaction, ctx: TenantContext, id: InvoiceId): Promise<Invoice | null> {
    const [invoice] = await this.load(tx, ctx, { id });

    return invoice ?? null;
  }

  async findByTransaction(
    tx: Transaction,
    ctx: TenantContext,
    transactionId: string,
  ): Promise<Invoice | null> {
    const [invoice] = await this.load(tx, ctx, { transactionId });

    return invoice ?? null;
  }

  listByPolicy(tx: Transaction, ctx: TenantContext, policyId: string): Promise<Invoice[]> {
    return this.load(tx, ctx, { policyId });
  }

  async nextSequence(tx: Transaction, ctx: TenantContext): Promise<number> {
    const [row] = await prismaTx(tx).$queryRaw<{ last_value: number }[]>`
      insert into invoice_sequences (tenant_id, last_value) values (${ctx.tenantId}, 1)
      on conflict (tenant_id) do update set last_value = invoice_sequences.last_value + 1
      returning last_value`;

    if (!row) throw new Error("Invoice sequence returned no row");

    return Number(row.last_value);
  }

  async addPayment(tx: Transaction, ctx: TenantContext, payment: PaymentProps): Promise<void> {
    await prismaTx(tx).payment.create({
      data: {
        id: payment.id,
        tenantId: ctx.tenantId,
        policyId: payment.policyId,
        invoiceId: payment.invoiceId,
        provider: payment.provider,
        providerRef: payment.providerRef,
        method: payment.method as Prisma.InputJsonValue,
        currency: payment.amount.currency,
        amount: payment.amount.toString(),
        receivedAt: toDate(payment.receivedAt),
      },
    });
  }

  async findPayment(
    tx: Transaction,
    ctx: TenantContext,
    provider: string,
    providerRef: string,
  ): Promise<PaymentProps | null> {
    const row = await prismaTx(tx).payment.findFirst({
      where: { tenantId: ctx.tenantId, provider, providerRef },
    });

    return row ? toPayment(row) : null;
  }

  async listPayments(
    tx: Transaction,
    ctx: TenantContext,
    policyId: string,
  ): Promise<PaymentProps[]> {
    const rows = await prismaTx(tx).payment.findMany({
      where: { tenantId: ctx.tenantId, policyId },
      orderBy: { receivedAt: "desc" },
    });

    return rows.map(toPayment);
  }

  private async load(
    tx: Transaction,
    ctx: TenantContext,
    where: Prisma.InvoiceWhereInput,
  ): Promise<Invoice[]> {
    const db = prismaTx(tx);

    const rows = await db.invoice.findMany({
      where: { ...where, tenantId: ctx.tenantId },
      orderBy: { createdAt: "desc" },
    });

    if (rows.length === 0) return [];

    const lines = await db.invoiceLine.findMany({
      where: { tenantId: ctx.tenantId, invoiceId: { in: rows.map((r) => r.id) } },
      orderBy: { position: "asc" },
    });

    return rows.map((row) =>
      toInvoice(
        row,
        lines.filter((l) => l.invoiceId === row.id),
      ),
    );
  }
}

function toInvoice(row: InvoiceRow, lines: LineRow[]): Invoice {
  const props: InvoiceProps = {
    id: asId(row.id),
    tenantId: asId(row.tenantId),
    number: row.number,
    kind: row.kind as InvoiceProps["kind"],
    policyId: row.policyId,
    policyNumber: row.policyNumber,
    transactionId: row.transactionId,
    lines: lines.map((l) => ({
      kind: l.kind as ChargeKind,
      code: l.code,
      label: l.label,
      ...(l.coverage && { coverage: l.coverage }),
      ...(l.exposure && { exposure: l.exposure }),
      amount: money(l.amount, row.currency),
    })),
    total: money(row.total, row.currency),
    amountPaid: money(row.amountPaid, row.currency),
    status: row.status.toLowerCase() as InvoiceStatus,
    issuedOn: dateFromDb(row.issuedOn),
    dueOn: dateFromDb(row.dueOn),
    createdAt: toInstant(row.createdAt),
    updatedAt: toInstant(row.updatedAt),
  };

  return Invoice.restore(props);
}

function toPayment(row: Prisma.PaymentGetPayload<object>): PaymentProps {
  return {
    id: row.id,
    policyId: row.policyId,
    invoiceId: asId(row.invoiceId),
    provider: row.provider,
    providerRef: row.providerRef,
    method: row.method as Record<string, unknown>,
    amount: money(row.amount, row.currency),
    receivedAt: toInstant(row.receivedAt),
  };
}
