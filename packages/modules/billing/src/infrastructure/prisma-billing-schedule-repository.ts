import { prismaTx } from "@pas/db";
import {
  type BillingSchedule as Row,
  type PaymentMethod as MethodRow,
  Prisma,
} from "@pas/db/client";
import { asId, type TenantContext, type Transaction } from "@pas/kernel";
import { billingConfigOf, type PayPlan } from "@pas/pay-plans";
import {
  BillingSchedule,
  type BillingMethod,
  type SavedPaymentMethod,
} from "../domain/billing-schedule";
import type { PayerDetails } from "../domain/invoice";
import type { BillingScheduleRepository } from "../ports/billing-schedule-repository";

const toDate = (i: Temporal.Instant) => new Date(i.epochMilliseconds);
const toInstant = (d: Date) => Temporal.Instant.fromEpochMilliseconds(d.getTime());
const json = (value: unknown) => value as Prisma.InputJsonValue;

export class PrismaBillingScheduleRepository implements BillingScheduleRepository {
  async save(tx: Transaction, schedule: BillingSchedule): Promise<void> {
    const s = schedule.toSnapshot();

    const data = {
      status: s.status,
      paymentMethodId: s.paymentMethodId,
      billingMethod: s.billingMethod,
      payer: s.payer.payer,
      payerRef: s.payer.payerRef,
      payerName: s.payer.payerName,
      payerAddress: s.payer.payerAddress ? json(s.payer.payerAddress) : Prisma.DbNull,
      updatedAt: toDate(s.updatedAt),
    };

    await prismaTx(tx).billingSchedule.upsert({
      where: { id: s.id },
      create: {
        ...data,
        id: s.id,
        tenantId: s.tenantId,
        policyId: s.policyId,
        policyNumber: s.policyNumber,
        termId: s.termId,
        plan: json(s.plan),
        dunning: json(s.dunning),
        createdAt: toDate(s.createdAt),
      },
      update: data,
    });
  }

  async findById(tx: Transaction, ctx: TenantContext, id: string) {
    const row = await prismaTx(tx).billingSchedule.findFirst({
      where: { id, tenantId: ctx.tenantId },
    });

    return row ? toSchedule(row) : null;
  }

  async findByTerm(tx: Transaction, ctx: TenantContext, termId: string) {
    const row = await prismaTx(tx).billingSchedule.findFirst({
      where: { termId, tenantId: ctx.tenantId },
    });

    return row ? toSchedule(row) : null;
  }

  async findByPolicy(tx: Transaction, ctx: TenantContext, policyId: string) {
    const row = await prismaTx(tx).billingSchedule.findFirst({
      where: { policyId, tenantId: ctx.tenantId },
      orderBy: { createdAt: "desc" },
    });

    return row ? toSchedule(row) : null;
  }

  async savePaymentMethod(tx: Transaction, ctx: TenantContext, method: SavedPaymentMethod) {
    const data = { status: method.status, updatedAt: toDate(method.updatedAt) };

    await prismaTx(tx).paymentMethod.upsert({
      where: { id: method.id },
      create: {
        ...data,
        id: method.id,
        tenantId: ctx.tenantId,
        policyId: method.policyId,
        provider: method.provider,
        providerRef: method.providerRef,
        customerRef: method.customerRef,
        brand: method.brand,
        last4: method.last4,
        expMonth: method.expMonth,
        expYear: method.expYear,
        consent: json(method.consent),
        createdAt: toDate(method.createdAt),
      },
      update: data,
    });
  }

  async findPaymentMethod(tx: Transaction, ctx: TenantContext, id: string) {
    const row = await prismaTx(tx).paymentMethod.findFirst({
      where: { id, tenantId: ctx.tenantId },
    });

    return row ? toMethod(row) : null;
  }
}

function toSchedule(row: Row): BillingSchedule {
  return BillingSchedule.restore({
    id: row.id,
    tenantId: asId(row.tenantId),
    policyId: row.policyId,
    policyNumber: row.policyNumber,
    termId: row.termId,
    billingMethod: row.billingMethod as BillingMethod,
    payer: {
      payer: row.payer as PayerDetails["payer"],
      payerRef: row.payerRef,
      payerName: row.payerName,
      payerAddress: row.payerAddress as PayerDetails["payerAddress"],
    },
    plan: row.plan as unknown as PayPlan,
    dunning: billingConfigOf({ dunning: row.dunning }).dunning,
    status: row.status as "active" | "closed",
    paymentMethodId: row.paymentMethodId,
    createdAt: toInstant(row.createdAt),
    updatedAt: toInstant(row.updatedAt),
  });
}

function toMethod(row: MethodRow): SavedPaymentMethod {
  return {
    id: row.id,
    policyId: row.policyId,
    provider: row.provider,
    providerRef: row.providerRef,
    customerRef: row.customerRef,
    brand: row.brand,
    last4: row.last4,
    expMonth: row.expMonth,
    expYear: row.expYear,
    consent: row.consent as SavedPaymentMethod["consent"],
    status: row.status as SavedPaymentMethod["status"],
    createdAt: toInstant(row.createdAt),
    updatedAt: toInstant(row.updatedAt),
  };
}
