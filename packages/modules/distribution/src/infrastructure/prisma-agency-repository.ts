import { prismaTx } from "@pas/db";
import type { Agency as AgencyRow, Prisma } from "@pas/db/client";
import { asId, Money, type TenantContext, type Transaction } from "@pas/kernel";
import type {
  Agency,
  AgencyAddress,
  AgencyStatus,
  CommissionBasis,
  RemittanceBasis,
} from "../domain/agency";
import type { AgencyRepository } from "../ports/agency-repository";
import { toDate, toInstant } from "./mappers";

const toAgency = (row: AgencyRow): Agency => ({
  id: asId(row.id),
  tenantId: asId(row.tenantId),
  parentId: row.parentId ? asId(row.parentId) : null,
  name: row.name,
  legalName: row.legalName,
  fein: row.fein,
  address: row.address as AgencyAddress | null,
  phone: row.phone,
  email: row.email,
  status: row.status as AgencyStatus,
  tier: row.tier,
  billing: {
    eligible: row.agencyBillEligible,
    remittanceDays: row.remittanceDays,
    creditLimit: row.creditLimit ? Money.of(row.creditLimit.toString(), row.currency) : null,
    remittanceBasis: row.remittanceBasis as RemittanceBasis,
    commissionBasis: (row.commissionBasis as CommissionBasis | null) ?? null,
    statementDay: row.statementDay,
    reminderDays: row.reminderDays,
    suspendAfterDays: row.suspendAfterDays,
    nonpaymentCancels: row.nonpaymentCancels,
    suspension: row.agencyBillSuspendedAt
      ? { at: toInstant(row.agencyBillSuspendedAt), reason: row.agencyBillSuspendedReason ?? "" }
      : null,
  },
  createdAt: toInstant(row.createdAt),
  updatedAt: toInstant(row.updatedAt),
});

export class PrismaAgencyRepository implements AgencyRepository {
  async list(tx: Transaction, ctx: TenantContext): Promise<Agency[]> {
    const rows = await prismaTx(tx).agency.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { name: "asc" },
    });

    return rows.map(toAgency);
  }

  async findById(tx: Transaction, ctx: TenantContext, id: string): Promise<Agency | null> {
    const row = await prismaTx(tx).agency.findFirst({ where: { tenantId: ctx.tenantId, id } });

    return row && toAgency(row);
  }

  async save(tx: Transaction, agency: Agency): Promise<void> {
    const data = {
      parentId: agency.parentId,
      name: agency.name,
      legalName: agency.legalName,
      fein: agency.fein,
      address: (agency.address ?? undefined) as Prisma.InputJsonValue | undefined,
      phone: agency.phone,
      email: agency.email,
      status: agency.status,
      tier: agency.tier,
      agencyBillEligible: agency.billing.eligible,
      remittanceDays: agency.billing.remittanceDays,
      creditLimit: agency.billing.creditLimit?.toString() ?? null,
      currency: agency.billing.creditLimit?.currency ?? "USD",
      remittanceBasis: agency.billing.remittanceBasis,
      commissionBasis: agency.billing.commissionBasis,
      statementDay: agency.billing.statementDay,
      reminderDays: agency.billing.reminderDays,
      suspendAfterDays: agency.billing.suspendAfterDays,
      nonpaymentCancels: agency.billing.nonpaymentCancels,
      agencyBillSuspendedAt: agency.billing.suspension
        ? toDate(agency.billing.suspension.at)
        : null,
      agencyBillSuspendedReason: agency.billing.suspension?.reason ?? null,
      updatedAt: toDate(agency.updatedAt),
    };

    await prismaTx(tx).agency.upsert({
      where: { id: agency.id },
      update: data,
      create: {
        ...data,
        id: agency.id,
        tenantId: agency.tenantId,
        createdAt: toDate(agency.createdAt),
      },
    });
  }
}
