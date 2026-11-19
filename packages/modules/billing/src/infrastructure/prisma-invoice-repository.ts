import {
  instantFromDb,
  instantToDb,
  moneyFromDb,
  plainDateFromDb,
  plainDateToDb,
  prismaTx,
} from "@pas/db";
import {
  type InvoiceStatus as DbInvoiceStatus,
  type Invoice as InvoiceRow,
  type InvoiceLine as LineRow,
  Prisma,
} from "@pas/db/client";
import { asId, newId, type TenantContext, type Transaction } from "@pas/kernel";
import {
  Invoice,
  type InvoiceId,
  type InvoiceProps,
  type InvoiceStatus,
  type PaymentProps,
} from "../domain/invoice";
import type { ChargeKind } from "../domain/invoice-lines";
import type { InvoiceRepository } from "../ports/invoice-repository";

export class PrismaInvoiceRepository implements InvoiceRepository {
  async save(tx: Transaction, invoice: Invoice): Promise<void> {
    const db = prismaTx(tx);
    const i = invoice.toSnapshot();

    const data = {
      amountPaid: i.amountPaid.toString(),
      amountCredited: i.amountCredited.toString(),
      amountWrittenOff: i.amountWrittenOff.toString(),
      total: i.total.toString(),
      status: i.status.toUpperCase() as DbInvoiceStatus,
      issuedOn: plainDateToDb(i.issuedOn),
      dueOn: plainDateToDb(i.dueOn),
      payer: i.payer,
      payerRef: i.payerRef,
      payerName: i.payerName,
      payerAddress: i.payerAddress
        ? (i.payerAddress as unknown as Prisma.InputJsonValue)
        : Prisma.DbNull,
      updatedAt: instantToDb(i.updatedAt),
    };

    const existing = await db.invoice.findUnique({ where: { id: i.id }, select: { id: true } });

    if (existing) {
      await db.invoice.update({ where: { id: i.id }, data });

      const stored = await db.invoiceLine.count({
        where: { tenantId: i.tenantId, invoiceId: i.id },
      });

      await this.addLines(tx, invoice, stored);

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
        scheduleId: i.scheduleId,
        installment: i.installment,
        installments: i.installments,
        currency: i.total.currency,
        createdAt: instantToDb(i.createdAt),
      },
    });

    await this.addLines(tx, invoice, 0);
  }

  // Lines are append-only: adjustments add lines, they never rewrite printed ones.
  private async addLines(tx: Transaction, invoice: Invoice, from: number): Promise<void> {
    const i = invoice.toSnapshot();
    const added = i.lines.slice(from);

    if (added.length === 0) return;

    await prismaTx(tx).invoiceLine.createMany({
      data: added.map((line, offset) => ({
        id: newId(),
        tenantId: i.tenantId,
        invoiceId: i.id,
        transactionId: line.transactionId ?? null,
        position: from + offset,
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
    const [invoice] = await this.load(tx, ctx, { transactionId, installment: 1 });

    return invoice ?? null;
  }

  listByPolicy(tx: Transaction, ctx: TenantContext, policyId: string): Promise<Invoice[]> {
    return this.load(tx, ctx, { policyId });
  }

  listByPolicies(
    tx: Transaction,
    ctx: TenantContext,
    policyIds: readonly string[],
  ): Promise<Invoice[]> {
    return this.load(tx, ctx, { policyId: { in: [...policyIds] } });
  }

  listAll(tx: Transaction, ctx: TenantContext): Promise<Invoice[]> {
    return this.load(tx, ctx, {});
  }

  listBySchedule(tx: Transaction, ctx: TenantContext, scheduleId: string): Promise<Invoice[]> {
    return this.load(tx, ctx, { scheduleId });
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
        kind: payment.kind,
        tenantId: ctx.tenantId,
        policyId: payment.policyId,
        invoiceId: payment.invoiceId,
        provider: payment.provider,
        providerRef: payment.providerRef,
        method: payment.method as Prisma.InputJsonValue,
        currency: payment.amount.currency,
        amount: payment.amount.toString(),
        receivedAt: instantToDb(payment.receivedAt),
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
    scheduleId: row.scheduleId,
    installment: row.installment,
    installments: row.installments,
    payer: row.payer as InvoiceProps["payer"],
    payerRef: row.payerRef,
    payerName: row.payerName,
    payerAddress: row.payerAddress as InvoiceProps["payerAddress"],
    lines: lines.map((l) => ({
      kind: l.kind as ChargeKind,
      ...(l.transactionId && { transactionId: l.transactionId }),
      code: l.code,
      label: l.label,
      ...(l.coverage && { coverage: l.coverage }),
      ...(l.exposure && { exposure: l.exposure }),
      amount: moneyFromDb(l.amount, row.currency),
    })),
    total: moneyFromDb(row.total, row.currency),
    amountPaid: moneyFromDb(row.amountPaid, row.currency),
    amountCredited: moneyFromDb(row.amountCredited, row.currency),
    amountWrittenOff: moneyFromDb(row.amountWrittenOff, row.currency),
    status: row.status.toLowerCase() as InvoiceStatus,
    issuedOn: plainDateFromDb(row.issuedOn),
    dueOn: plainDateFromDb(row.dueOn),
    createdAt: instantFromDb(row.createdAt),
    updatedAt: instantFromDb(row.updatedAt),
  };

  return Invoice.restore(props);
}

function toPayment(row: Prisma.PaymentGetPayload<object>): PaymentProps {
  return {
    id: row.id,
    kind: row.kind as PaymentProps["kind"],
    policyId: row.policyId,
    invoiceId: asId(row.invoiceId),
    provider: row.provider,
    providerRef: row.providerRef,
    method: row.method as Record<string, unknown>,
    amount: moneyFromDb(row.amount, row.currency),
    receivedAt: instantFromDb(row.receivedAt),
  };
}
