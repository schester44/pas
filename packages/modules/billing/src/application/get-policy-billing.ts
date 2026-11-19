import {
  type ClockProvider,
  Money,
  type TenantContext,
  type Transaction,
  type UnitOfWork,
} from "@pas/kernel";
import type { Invoice } from "../domain/invoice";
import type { AgencyStatementRepository } from "../ports/agency-statement-repository";
import type { BillingScheduleRepository } from "../ports/billing-schedule-repository";
import type { MortgageeBillRepository } from "../ports/mortgagee-bill-repository";
import { type MortgageeStatusDto, toMortgageeStatusDto } from "./mortgagee-billing";
import type { InvoiceRepository } from "../ports/invoice-repository";
import { type InvoiceDto, type PaymentDto, toInvoiceDto, toPaymentDto } from "./dto";

type MoneyDto = { amount: string; currency: string };

export interface BillingScheduleDto {
  id: string;
  status: "active" | "closed";
  billingMethod: string;
  payer: { kind: string; reference: string | null; name: string | null; address: unknown };
  plan: {
    key: string;
    label: string;
    installments: number;
    intervalMonths: number;
    graceDays: number;
  };
  autopay: { brand: string; last4: string; expMonth: number; expYear: number } | null;
  hasSavedMethod: boolean;
  delinquencySource: "pas" | "billing_system";
}

export interface PolicyBillingDto {
  invoices: InvoiceDto[];
  payments: PaymentDto[];
  balance: MoneyDto | null;
  schedule: BillingScheduleDto | null;
  pastDue: MoneyDto | null;
  nextDue: { invoiceId: string; number: string; dueOn: string; amount: MoneyDto } | null;
  statements: {
    invoiceId: string;
    statementId: string;
    number: string;
    status: string;
    dueOn: string;
  }[];
  mortgagee: MortgageeStatusDto | null;
}

export function pastDueOf(invoices: readonly Invoice[]): Money | null {
  const currency = invoices[0]?.toSnapshot().total.currency;

  if (!currency) return null;

  return invoices
    .filter((i) => i.status === "past_due")
    .reduce((sum, i) => sum.plus(i.balance), Money.zero(currency));
}

export async function scheduleDto(
  schedules: BillingScheduleRepository,
  tx: Transaction,
  ctx: TenantContext,
  policyId: string,
): Promise<BillingScheduleDto | null> {
  const schedule = await schedules.findByPolicy(tx, ctx, policyId);

  if (!schedule) return null;

  const s = schedule.toSnapshot();

  const method = s.paymentMethodId
    ? await schedules.findPaymentMethod(tx, ctx, s.paymentMethodId)
    : null;

  const active = method?.status === "active" ? method : null;

  return {
    id: s.id,
    status: s.status,
    billingMethod: s.billingMethod,
    payer: {
      kind: s.payer.payer,
      reference: s.payer.payerRef,
      name: s.payer.payerName,
      address: s.payer.payerAddress,
    },
    plan: {
      key: s.plan.key,
      label: s.plan.label,
      installments: s.plan.installments,
      intervalMonths: s.plan.intervalMonths,
      graceDays: s.plan.graceDays,
    },
    autopay: active && {
      brand: active.brand,
      last4: active.last4,
      expMonth: active.expMonth,
      expYear: active.expYear,
    },
    hasSavedMethod: active !== null,
    delinquencySource: s.dunning.delinquencySource,
  };
}

/** Invoices, payments, the installment schedule and what's owed for one policy. Callers check access. */
export function makeGetPolicyBilling(deps: {
  uow: UnitOfWork;
  invoices: InvoiceRepository;
  schedules: BillingScheduleRepository;
  statements: AgencyStatementRepository;
  mortgageeBills: MortgageeBillRepository;
  clocks: ClockProvider;
}) {
  return async function getPolicyBilling(
    ctx: TenantContext,
    input: { policyId: string },
  ): Promise<PolicyBillingDto> {
    return deps.uow.run(ctx, async (tx) => {
      const [invoices, payments, schedule, mortgagee] = await Promise.all([
        deps.invoices.listByPolicy(tx, ctx, input.policyId),
        deps.invoices.listPayments(tx, ctx, input.policyId),
        scheduleDto(deps.schedules, tx, ctx, input.policyId),
        deps.mortgageeBills.latestForPolicy(tx, ctx, input.policyId),
      ]);

      const statements = await deps.statements.forInvoices(
        tx,
        ctx,
        invoices.filter((i) => i.toSnapshot().payer === "agency").map((i) => i.id),
      );

      const currency = invoices[0]?.toSnapshot().total.currency;

      const balance = currency
        ? invoices
            .filter(
              (i) => i.toSnapshot().status !== "void" && i.toSnapshot().status !== "scheduled",
            )
            .reduce((sum, i) => sum.plus(i.balance), Money.zero(currency))
        : null;

      const next = invoices
        .filter((i) => i.isUnpaid && i.balance.amount.greaterThan(0))
        .toSorted((a, b) =>
          Temporal.PlainDate.compare(a.toSnapshot().dueOn, b.toSnapshot().dueOn),
        )[0];

      return {
        invoices: invoices
          .map(toInvoiceDto)
          .toSorted(
            (a, b) => b.issuedOn.localeCompare(a.issuedOn) || b.installment - a.installment,
          ),
        payments: payments.map(toPaymentDto),
        balance: balance?.toJSON() ?? null,
        schedule,
        pastDue: pastDueOf(invoices)?.toJSON() ?? null,
        nextDue: next
          ? {
              invoiceId: next.id,
              number: next.toSnapshot().number,
              dueOn: next.toSnapshot().dueOn.toString(),
              amount: next.balance.toJSON(),
            }
          : null,
        statements: [...statements].map(([invoiceId, ref]) => ({
          invoiceId,
          statementId: ref.statementId,
          number: ref.number,
          status: ref.status,
          dueOn: ref.dueOn.toString(),
        })),
        mortgagee:
          mortgagee &&
          toMortgageeStatusDto(mortgagee, deps.clocks.forTenant(ctx.tenantId).today("UTC")),
      };
    });
  };
}

export type GetPolicyBilling = ReturnType<typeof makeGetPolicyBilling>;
