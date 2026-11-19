import { prismaTx } from "@pas/db";
import type { Commission as CommissionRow } from "@pas/db/client";
import { Money, newId, type TenantContext, type Transaction } from "@pas/kernel";
import type { Business, CommissionSchedule } from "../domain/commission";
import type { LicensingMode } from "../domain/license";
import type {
  CommissionRecord,
  CommissionRepository,
  LicensingRequirement,
} from "../ports/commission-repository";
import { dateFromDb, dateToDb, decimal, optionalDate, toDate, toInstant } from "./mappers";

const toRecord = (row: CommissionRow): CommissionRecord => ({
  id: row.id,
  financialTransactionId: row.financialTransactionId,
  transactionId: row.transactionId,
  transactionType: row.transactionType,
  policyId: row.policyId,
  policyNumber: row.policyNumber,
  insuredName: row.insuredName,
  agencyId: row.agencyId,
  producerId: row.producerId,
  scheduleId: row.scheduleId,
  business: row.business as Business,
  premium: Money.of(decimal(row.premium), row.currency),
  rate: decimal(row.rate),
  amount: Money.of(decimal(row.amount), row.currency),
  effectiveDate: dateFromDb(row.effectiveDate),
  recordedAt: toInstant(row.recordedAt),
});

export class PrismaCommissionRepository implements CommissionRepository {
  async schedules(tx: Transaction, ctx: TenantContext): Promise<CommissionSchedule[]> {
    const rows = await prismaTx(tx).commissionSchedule.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: [{ effectiveDate: "desc" }, { createdAt: "asc" }],
    });

    return rows.map((row) => ({
      id: row.id,
      productId: row.productId,
      country: row.country,
      subdivision: row.subdivision,
      business: row.business as Business | null,
      tier: row.tier,
      rate: decimal(row.rate),
      effectiveDate: dateFromDb(row.effectiveDate),
      expirationDate: optionalDate(row.expirationDate),
    }));
  }

  async saveSchedule(
    tx: Transaction,
    ctx: TenantContext,
    s: CommissionSchedule,
    at: Temporal.Instant,
  ): Promise<void> {
    const data = {
      productId: s.productId,
      country: s.country,
      subdivision: s.subdivision,
      business: s.business,
      tier: s.tier,
      rate: s.rate,
      effectiveDate: dateToDb(s.effectiveDate),
      expirationDate: s.expirationDate ? dateToDb(s.expirationDate) : null,
    };

    const existing = await prismaTx(tx).commissionSchedule.findFirst({
      where: { tenantId: ctx.tenantId, id: s.id },
    });

    if (existing) {
      await prismaTx(tx).commissionSchedule.update({ where: { id: s.id }, data });

      return;
    }

    await prismaTx(tx).commissionSchedule.create({
      data: { ...data, id: s.id, tenantId: ctx.tenantId, createdAt: toDate(at) },
    });
  }

  async deleteSchedule(tx: Transaction, ctx: TenantContext, id: string): Promise<void> {
    await prismaTx(tx).commissionSchedule.deleteMany({ where: { tenantId: ctx.tenantId, id } });
  }

  async record(
    tx: Transaction,
    ctx: TenantContext,
    rows: readonly CommissionRecord[],
  ): Promise<number> {
    const result = await prismaTx(tx).commission.createMany({
      data: rows.map((r) => ({
        id: r.id,
        tenantId: ctx.tenantId,
        financialTransactionId: r.financialTransactionId,
        transactionId: r.transactionId,
        transactionType: r.transactionType,
        policyId: r.policyId,
        policyNumber: r.policyNumber,
        insuredName: r.insuredName,
        agencyId: r.agencyId,
        producerId: r.producerId,
        scheduleId: r.scheduleId,
        business: r.business,
        premium: r.premium.toString(),
        rate: r.rate,
        amount: r.amount.toString(),
        currency: r.amount.currency,
        effectiveDate: dateToDb(r.effectiveDate),
        recordedAt: toDate(r.recordedAt),
      })),
      skipDuplicates: true,
    });

    return result.count;
  }

  async list(
    tx: Transaction,
    ctx: TenantContext,
    filter: {
      agencyIds?: readonly string[];
      policyId?: string;
      transactionIds?: readonly string[];
      from?: Temporal.Instant;
      to?: Temporal.Instant;
    },
  ): Promise<CommissionRecord[]> {
    const rows = await prismaTx(tx).commission.findMany({
      where: {
        tenantId: ctx.tenantId,
        ...(filter.agencyIds && { agencyId: { in: [...filter.agencyIds] } }),
        ...(filter.policyId && { policyId: filter.policyId }),
        ...(filter.transactionIds && { transactionId: { in: [...filter.transactionIds] } }),
        ...((filter.from || filter.to) && {
          recordedAt: {
            ...(filter.from && { gte: toDate(filter.from) }),
            ...(filter.to && { lt: toDate(filter.to) }),
          },
        }),
      },
      orderBy: [{ recordedAt: "asc" }, { policyNumber: "asc" }],
    });

    return rows.map(toRecord);
  }

  async requirements(tx: Transaction, ctx: TenantContext): Promise<LicensingRequirement[]> {
    const rows = await prismaTx(tx).licensingRequirement.findMany({
      where: { tenantId: ctx.tenantId },
    });

    return rows.map((row) => ({
      productId: row.productId,
      mode: row.mode as LicensingMode,
      linesOfAuthority: row.linesOfAuthority,
    }));
  }

  async saveRequirement(
    tx: Transaction,
    ctx: TenantContext,
    r: LicensingRequirement,
    at: Temporal.Instant,
  ): Promise<void> {
    const data = { mode: r.mode, linesOfAuthority: r.linesOfAuthority, updatedAt: toDate(at) };

    await prismaTx(tx).licensingRequirement.upsert({
      where: { tenantId_productId: { tenantId: ctx.tenantId, productId: r.productId } },
      update: data,
      create: { ...data, id: newId(), tenantId: ctx.tenantId, productId: r.productId },
    });
  }
}
