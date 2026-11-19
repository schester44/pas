// Records commissions for issued transactions that predate commission recording. Idempotent.
import { getPrismaClient, PrismaUnitOfWork } from "@pas/db";
import { makeRecordCommissions } from "@pas/distribution";
import {
  PrismaAgencyRepository,
  PrismaCommissionRepository,
} from "@pas/distribution/infrastructure";
import { asId } from "@pas/kernel";
import { makeGetTransactionFinancials } from "@pas/policy";
import { PrismaPolicyRepository } from "@pas/policy/infrastructure";
import { TenantClocks } from "@pas/tenants/infrastructure";

const prisma = getPrismaClient();
const uow = new PrismaUnitOfWork(prisma);
const clocks = new TenantClocks(prisma);
await clocks.start();

const recordCommissions = makeRecordCommissions({
  uow,
  agencies: new PrismaAgencyRepository(),
  commissions: new PrismaCommissionRepository(),
  clocks,
  financials: {
    transaction: makeGetTransactionFinancials({ uow, policies: new PrismaPolicyRepository() }),
  },
});

const issued = await prisma.policyTransaction.findMany({
  where: { status: "issued" },
  orderBy: { recordedAt: "asc" },
  select: { tenantId: true, policyId: true, id: true },
});

let recorded = 0;

for (const t of issued) {
  const ctx = {
    tenantId: asId<"Tenant">(t.tenantId),
    actor: { type: "system" as const, process: "backfill" },
  };

  recorded += (await recordCommissions(ctx, { policyId: t.policyId, transactionId: t.id }))
    .recorded;
}

console.log(`Recorded ${recorded} commission lines across ${issued.length} transactions`);
clocks.stop();
await prisma.$disconnect();
