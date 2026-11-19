import {
  type DomainEvent,
  Money,
  newId,
  parsePlainDate,
  type TenantContext,
  type Transaction,
  type ClockProvider,
} from "@pas/kernel";
import {
  buildSchedule,
  type Dunning,
  type MortgageeFollowUp,
  netCredit,
  type PayPlan,
  spreadCharge,
} from "@pas/pay-plans";
import { BillingSchedule, type BillingMethod, INSURED } from "../domain/billing-schedule";
import { Invoice, type PayerDetails } from "../domain/invoice";
import { MortgageeBill } from "../domain/mortgagee-bill";
import type { MortgageeBillRepository } from "../ports/mortgagee-bill-repository";
import { type Charge, type ChargeKind, invoiceFrom, totalOf } from "../domain/invoice-lines";
import { formatInvoiceNumber } from "../domain/invoice-number";
import type { BillingScheduleRepository } from "../ports/billing-schedule-repository";
import { applyBillingEventIn, type BillingEventDeps } from "./apply-billing-event";
import { type InvoiceDto, toInvoiceDto } from "./dto";

type MoneyJson = { amount: string; currency: string };

const ROUNDING = { places: 2, mode: "half_up" as const };

export interface IssueInvoiceInput {
  policyId: string;
  policyNumber: string;
  termId: string;
  transactionId: string;
  transactionType: string;
  effectiveDate: string;
  /** The risk's jurisdiction code, so a billing system can hold taxes and fees per jurisdiction. */
  jurisdiction?: string;
  currency: string;
  charges: {
    kind: ChargeKind;
    code: string;
    label: string;
    coverage?: string;
    exposure?: string;
    amount: MoneyJson;
  }[];
  issuedOn: string;
  dueOn: string;
  schedule?: {
    plan: PayPlan;
    dunning: Dunning;
    billingMethod: BillingMethod;
    payer?: PayerDetails;
    mortgagee?: { followUp: MortgageeFollowUp; lenderEmail: string | null };
  };
}

export interface IssuedInvoiceDto extends InvoiceDto {
  spread?: { installments: number; numbers: string[] };
  netted?: { credited: MoneyJson; installments: number };
}

type Deps = BillingEventDeps & {
  schedules: BillingScheduleRepository;
  mortgageeBills: MortgageeBillRepository;
  clocks: ClockProvider;
};

const SYSTEM = { type: "system" as const, name: "Billing" };

/**
 * Bills one financial policy transaction inside the issuing context's transaction, so a
 * transaction is never issued without its bill. New business under a pay plan creates the
 * installment schedule; on a term with installments, additional premium is spread over the
 * installments not yet billed and credits net against unpaid installments before any refund.
 */
export function makeIssueInvoice(deps: Deps) {
  return async function issueInvoice(
    tx: Transaction,
    ctx: TenantContext,
    input: IssueInvoiceInput,
  ): Promise<IssuedInvoiceDto> {
    const existing = await deps.invoices.findByTransaction(tx, ctx, input.transactionId);

    if (existing) return toInvoiceDto(existing);

    const charges: Charge[] = input.charges.map((c) => ({
      ...c,
      amount: Money.of(c.amount.amount, c.amount.currency),
    }));

    if (input.schedule) return startSchedule(deps, tx, ctx, input, charges, input.schedule);

    const schedule = await deps.schedules.findByTerm(tx, ctx, input.termId);
    const draft = invoiceFrom(charges, input.currency, ROUNDING);

    if (schedule?.isActive && draft.kind === "invoice" && input.transactionType === "ENDORSEMENT") {
      const spread = await spreadOver(deps, tx, ctx, input, schedule, draft.lines);

      if (spread) return spread;
    }

    const invoice = await issue(deps, tx, ctx, input, {
      draft,
      ...(schedule?.isActive && { payer: schedule.payer }),
    });

    if (schedule?.isActive && draft.kind === "credit_note" && schedule.payer.payer !== "agency") {
      return netAgainstInstallments(deps, tx, ctx, input, schedule, invoice);
    }

    return toInvoiceDto(invoice);
  };
}

async function issue(
  deps: Deps,
  tx: Transaction,
  ctx: TenantContext,
  input: IssueInvoiceInput,
  options: Pick<
    Parameters<typeof Invoice.issue>[0],
    "draft" | "scheduled" | "scheduleId" | "installment" | "installments"
  > & {
    issuedOn?: Temporal.PlainDate;
    dueOn?: Temporal.PlainDate;
    payer?: PayerDetails;
  },
): Promise<Invoice> {
  const { issuedOn, dueOn, payer, ...rest } = options;

  const invoice = Invoice.issue(
    {
      ...rest,
      ...payer,
      tenantId: ctx.tenantId,
      number: formatInvoiceNumber(await deps.invoices.nextSequence(tx, ctx)),
      policyId: input.policyId,
      policyNumber: input.policyNumber,
      transactionId: input.transactionId,
      issuedOn: issuedOn ?? parsePlainDate(input.issuedOn),
      dueOn: dueOn ?? parsePlainDate(input.dueOn),
    },
    deps.clocks.forTenant(ctx.tenantId),
  );

  await deps.invoices.save(tx, invoice);

  await deps.outbox.add(tx, [
    invoiceIssued(ctx, invoice, input, deps.clocks.forTenant(ctx.tenantId).now()),
  ]);

  if (payer?.payer === "agency" && payer.payerRef) {
    await deps.outbox.add(tx, [
      {
        id: newId(),
        type: "billing.agency_invoice_issued",
        tenantId: ctx.tenantId,
        aggregateType: "invoice",
        aggregateId: invoice.id,
        occurredAt: deps.clocks.forTenant(ctx.tenantId).now(),
        payload: { invoiceId: invoice.id, policyId: input.policyId, agencyId: payer.payerRef },
      },
    ]);
  }

  return invoice;
}

/** The outbound billing fact a billing system books the invoice from (PLAN §13 `BillingGateway`). */
function invoiceIssued(
  ctx: TenantContext,
  invoice: Invoice,
  input: IssueInvoiceInput,
  now: Temporal.Instant,
): DomainEvent {
  const i = invoice.toSnapshot();

  return {
    id: newId(),
    type: "billing.invoice_issued",
    tenantId: ctx.tenantId,
    aggregateType: "invoice",
    aggregateId: i.id,
    occurredAt: now,
    payload: {
      occurredAt: now.toString(),
      invoice: {
        ...toInvoiceDto(invoice),
        jurisdiction: input.jurisdiction ?? null,
        currency: i.total.currency,
        lines: i.lines.map((line) => ({
          kind: line.kind,
          code: line.code,
          amount: line.amount.toJSON(),
        })),
      },
    },
  };
}

/** A scheduled installment became a bill: its installment fee is owed from now. */
export function invoiceOpened(
  ctx: TenantContext,
  invoice: Invoice,
  now: Temporal.Instant,
): DomainEvent {
  const i = invoice.toSnapshot();

  return {
    id: newId(),
    type: "billing.invoice_opened",
    tenantId: ctx.tenantId,
    aggregateType: "invoice",
    aggregateId: i.id,
    occurredAt: now,
    payload: {
      occurredAt: now.toString(),
      invoiceId: i.id,
      billedOn: i.issuedOn.toString(),
      fee: invoice.installmentFee.toJSON(),
    },
  };
}

async function startSchedule(
  deps: Deps,
  tx: Transaction,
  ctx: TenantContext,
  input: IssueInvoiceInput,
  charges: Charge[],
  config: NonNullable<IssueInvoiceInput["schedule"]>,
): Promise<IssuedInvoiceDto> {
  const clock = deps.clocks.forTenant(ctx.tenantId);

  const schedule = BillingSchedule.start(
    {
      tenantId: ctx.tenantId,
      policyId: input.policyId,
      policyNumber: input.policyNumber,
      termId: input.termId,
      billingMethod: config.billingMethod,
      payer: config.payer ?? INSURED,
      plan: config.plan,
      dunning: config.dunning,
    },
    clock,
  );

  await deps.schedules.save(tx, schedule);

  const premium = totalOf(
    charges.filter((c) => c.kind === "written_premium"),
    input.currency,
  );

  if (config.plan.installments <= 1) {
    const invoice = await issue(deps, tx, ctx, input, {
      draft: invoiceFrom(charges, input.currency, ROUNDING),
      scheduleId: schedule.id,
      payer: schedule.payer,
      ...(config.mortgagee && {
        dueOn: parsePlainDate(input.issuedOn).add({ days: config.mortgagee.followUp.dueDays }),
      }),
    });

    if (config.billingMethod === "mortgagee" && config.mortgagee) {
      await startMortgageeBill(deps, tx, ctx, input, invoice, config.mortgagee);
    }

    return toInvoiceDto(invoice);
  }

  const installments = buildSchedule(config.plan, {
    premium,
    taxesFees: charges
      .filter((c) => c.kind !== "written_premium")
      .map((c) => ({ code: c.code, label: c.label, amount: c.amount })),
    effectiveDate: parsePlainDate(input.effectiveDate),
    billedOn: parsePlainDate(input.issuedOn),
    rounding: ROUNDING,
  });

  const count = installments.length;
  const invoices: Invoice[] = [];

  for (const installment of installments) {
    const lines: Charge[] = [
      {
        kind: "written_premium",
        code: "PREMIUM",
        label: `Premium, installment ${installment.number} of ${count}`,
        amount: installment.premium,
      },
      ...installment.taxesFees.map((t) => ({ kind: "tax_fee" as const, ...t })),
      ...(installment.fee.isZero()
        ? []
        : [
            {
              kind: "installment_fee" as const,
              code: "INSTALLMENT_FEE",
              label: "Installment fee",
              amount: installment.fee,
            },
          ]),
    ];

    invoices.push(
      await issue(deps, tx, ctx, input, {
        draft: invoiceFrom(lines, input.currency, ROUNDING),
        scheduleId: schedule.id,
        installment: installment.number,
        installments: count,
        scheduled: installment.number > 1,
        issuedOn: installment.issueOn,
        dueOn: installment.dueOn,
      }),
    );
  }

  await deps.outbox.add(
    tx,
    invoices.slice(1).map((invoice) => ({
      id: newId(),
      type: "billing.installment_scheduled",
      tenantId: ctx.tenantId,
      aggregateType: "invoice",
      aggregateId: invoice.id,
      occurredAt: clock.now(),
      payload: { invoiceId: invoice.id, policyId: input.policyId, scheduleId: schedule.id },
    })),
  );

  return toInvoiceDto(invoices[0]!);
}

async function startMortgageeBill(
  deps: Deps,
  tx: Transaction,
  ctx: TenantContext,
  input: IssueInvoiceInput,
  invoice: Invoice,
  config: NonNullable<NonNullable<IssueInvoiceInput["schedule"]>["mortgagee"]>,
) {
  const clock = deps.clocks.forTenant(ctx.tenantId);
  const payer = invoice.payerDetails;

  const bill = MortgageeBill.start(
    {
      tenantId: ctx.tenantId,
      policyId: input.policyId,
      policyNumber: input.policyNumber,
      termId: input.termId,
      invoiceId: invoice.id,
      lender: {
        name: payer.payerName ?? "Mortgagee",
        loanNumber: payer.payerRef,
        address: payer.payerAddress,
        email: config.lenderEmail,
      },
      followUp: config.followUp,
    },
    clock,
  );

  await deps.mortgageeBills.save(tx, ctx, bill);
  await deps.outbox.add(tx, bill.pullEvents());
}

async function spreadOver(
  deps: Deps,
  tx: Transaction,
  ctx: TenantContext,
  input: IssueInvoiceInput,
  schedule: BillingSchedule,
  lines: readonly Charge[],
): Promise<IssuedInvoiceDto | null> {
  const remaining = (await deps.invoices.listBySchedule(tx, ctx, schedule.id))
    .filter((invoice) => invoice.status === "scheduled")
    .toSorted((a, b) => a.toSnapshot().installment - b.toSnapshot().installment);

  if (remaining.length === 0) return null;

  const currency = input.currency;

  const premium = totalOf(
    lines.filter((l) => l.kind === "written_premium"),
    currency,
  );

  const taxes = totalOf(
    lines.filter((l) => l.kind !== "written_premium"),
    currency,
  );

  const premiumShares = spreadCharge(premium, remaining.length, ROUNDING);
  const taxShares = spreadCharge(taxes, remaining.length, ROUNDING);
  const label = `Endorsement effective ${parsePlainDate(input.effectiveDate).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
  const clock = deps.clocks.forTenant(ctx.tenantId);

  for (const [index, invoice] of remaining.entries()) {
    const adjustment = [
      {
        kind: "written_premium" as const,
        code: "ENDORSEMENT",
        label,
        amount: premiumShares[index]!,
        transactionId: input.transactionId,
      },
      {
        kind: "tax_fee" as const,
        code: "ENDORSEMENT_TAXES",
        label: `${label}, taxes and fees`,
        amount: taxShares[index]!,
        transactionId: input.transactionId,
      },
    ].filter((line) => !line.amount.isZero());

    await applyBillingEventIn(deps, tx, ctx, {
      eventId: `spread:${input.transactionId}:${invoice.id}`,
      source: "pas",
      quiet: true,
      type: "invoice.adjusted",
      occurredAt: clock.now(),
      invoiceId: invoice.id,
      lines: adjustment,
      actor: SYSTEM,
    });
  }

  const first = (await deps.invoices.findById(tx, ctx, remaining[0]!.id))!;

  return {
    ...toInvoiceDto(first),
    total: totalOf(lines, currency).toJSON(),
    spread: {
      installments: remaining.length,
      numbers: remaining.map((i) => i.toSnapshot().number),
    },
  };
}

async function netAgainstInstallments(
  deps: Deps,
  tx: Transaction,
  ctx: TenantContext,
  input: IssueInvoiceInput,
  schedule: BillingSchedule,
  credit: Invoice,
): Promise<IssuedInvoiceDto> {
  const clock = deps.clocks.forTenant(ctx.tenantId);
  const cancelling = input.transactionType === "CANCELLATION";

  const unpaid = (await deps.invoices.listBySchedule(tx, ctx, schedule.id)).filter(
    (invoice) => invoice.isUnpaid && invoice.id !== credit.id,
  );

  const netting = netCredit(
    credit.balance.negated(),
    unpaid.map((invoice) => ({
      id: invoice.id,
      status: invoice.status as "scheduled" | "open" | "past_due" | "partially_paid",
      dueOn: invoice.toSnapshot().dueOn,
      balance: invoice.balance,
      fee: invoice.installmentFee,
    })),
    { waiveScheduledFees: cancelling },
  );

  let credited = Money.zero(input.currency);

  for (const allocation of netting.allocations) {
    if (!allocation.waivedFee.isZero()) {
      await applyBillingEventIn(deps, tx, ctx, {
        eventId: `waive:${input.transactionId}:${allocation.id}`,
        source: "pas",
        quiet: true,
        type: "invoice.adjusted",
        occurredAt: clock.now(),
        invoiceId: allocation.id,
        lines: [
          {
            kind: "installment_fee",
            code: "INSTALLMENT_FEE_WAIVED",
            label: "Installment fee waived",
            amount: allocation.waivedFee.negated(),
            transactionId: input.transactionId,
          },
        ],
        actor: SYSTEM,
      });
    }

    if (!allocation.credited.isZero()) {
      await applyBillingEventIn(deps, tx, ctx, {
        eventId: `net:${input.transactionId}:${allocation.id}`,
        source: "pas",
        quiet: true,
        type: "credit.applied",
        occurredAt: clock.now(),
        invoiceId: allocation.id,
        creditNoteId: credit.id,
        amount: allocation.credited,
        actor: SYSTEM,
      });

      credited = credited.plus(allocation.credited);
    }
  }

  if (cancelling) {
    const today = parsePlainDate(input.issuedOn);

    for (const invoice of await deps.invoices.listBySchedule(tx, ctx, schedule.id)) {
      if (invoice.status !== "scheduled" || !invoice.balance.amount.greaterThan(0)) continue;

      invoice.billNow(today, clock);
      await deps.invoices.save(tx, invoice);
      await deps.outbox.add(tx, [invoiceOpened(ctx, invoice, clock.now())]);
    }

    schedule.close(clock);
    await deps.schedules.save(tx, schedule);
  }

  const refreshed = (await deps.invoices.findById(tx, ctx, credit.id))!;

  return {
    ...toInvoiceDto(refreshed),
    netted: { credited: credited.toJSON(), installments: netting.allocations.length },
  };
}

export type IssueInvoice = ReturnType<typeof makeIssueInvoice>;
