import { prismaTx } from "@pas/db";
import type { MortgageeBill as Row, Prisma } from "@pas/db/client";
import { asId, type TenantContext, type Transaction } from "@pas/kernel";
import type { MortgageeFollowUp } from "@pas/pay-plans";
import {
  type Lender,
  MortgageeBill,
  type MortgageeBillStatus,
  type MortgageeHistoryEntry,
} from "../domain/mortgagee-bill";
import type { MortgageeBillRepository } from "../ports/mortgagee-bill-repository";

const toDate = (i: Temporal.Instant) => new Date(i.epochMilliseconds);
const toInstant = (d: Date) => Temporal.Instant.fromEpochMilliseconds(d.getTime());
const json = (value: unknown) => value as Prisma.InputJsonValue;

export class PrismaMortgageeBillRepository implements MortgageeBillRepository {
  async save(tx: Transaction, ctx: TenantContext, bill: MortgageeBill): Promise<void> {
    const b = bill.toSnapshot();

    const data = {
      lenderName: b.lender.name,
      loanNumber: b.lender.loanNumber,
      lenderAddress: b.lender.address ? json(b.lender.address) : undefined,
      lenderEmail: b.lender.email,
      status: b.status,
      sentOn: b.sentOn ? new Date(`${b.sentOn.toString()}T00:00:00Z`) : null,
      history: json(b.history),
      updatedAt: toDate(b.updatedAt),
    };

    await prismaTx(tx).mortgageeBill.upsert({
      where: { id: b.id },
      update: data,
      create: {
        ...data,
        id: b.id,
        tenantId: ctx.tenantId,
        policyId: b.policyId,
        policyNumber: b.policyNumber,
        termId: b.termId,
        invoiceId: b.invoiceId,
        followUp: json(b.followUp),
        createdAt: toDate(b.createdAt),
      },
    });
  }

  async findById(tx: Transaction, ctx: TenantContext, id: string) {
    const row = await prismaTx(tx).mortgageeBill.findFirst({
      where: { tenantId: ctx.tenantId, id },
    });

    return row && toBill(row);
  }

  async findByInvoice(tx: Transaction, ctx: TenantContext, invoiceId: string) {
    const row = await prismaTx(tx).mortgageeBill.findFirst({
      where: { tenantId: ctx.tenantId, invoiceId },
    });

    return row && toBill(row);
  }

  async latestForPolicy(tx: Transaction, ctx: TenantContext, policyId: string) {
    const row = await prismaTx(tx).mortgageeBill.findFirst({
      where: { tenantId: ctx.tenantId, policyId },
      orderBy: { createdAt: "desc" },
    });

    return row && toBill(row);
  }
}

function toBill(row: Row): MortgageeBill {
  return MortgageeBill.restore({
    id: row.id,
    tenantId: asId(row.tenantId),
    policyId: row.policyId,
    policyNumber: row.policyNumber,
    termId: row.termId,
    invoiceId: row.invoiceId,
    lender: {
      name: row.lenderName,
      loanNumber: row.loanNumber,
      address: row.lenderAddress as Lender["address"],
      email: row.lenderEmail,
    },
    followUp: row.followUp as unknown as MortgageeFollowUp,
    status: row.status as MortgageeBillStatus,
    sentOn: row.sentOn ? Temporal.PlainDate.from(row.sentOn.toISOString().slice(0, 10)) : null,
    history: row.history as unknown as MortgageeHistoryEntry[],
    createdAt: toInstant(row.createdAt),
    updatedAt: toInstant(row.updatedAt),
  });
}
