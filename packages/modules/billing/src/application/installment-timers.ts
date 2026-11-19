import {
  asId,
  type ClockProvider,
  type ProviderFor,
  type TenantContext,
  type UnitOfWork,
} from "@pas/kernel";
import type { Invoice } from "../domain/invoice";
import type { BillingNotices } from "../ports/billing-notices";
import type { BillingScheduleRepository } from "../ports/billing-schedule-repository";
import type { PaymentGateway } from "../ports/payment-gateway";
import { type ApplyBillingEvent, type BillingEventDeps, formatMoney } from "./apply-billing-event";
import { pastDueOf } from "./get-policy-billing";

export type InstallmentAction = "open" | "charge" | "past_due" | "retry" | "remind" | "delinquent";

export interface InstallmentStep {
  id: string;
  action: InstallmentAction;
  on: string;
}

const SYSTEM = { type: "system" as const, name: "Billing" };

const settled = (invoice: Invoice | null) =>
  !invoice || !invoice.isUnpaid || !invoice.balance.amount.greaterThan(0);

const formatDate = (date: Temporal.PlainDate) =>
  date.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" });

/**
 * What the `billing.installment` workflow does on its dates (PLAN §13): open the installment,
 * charge autopay on the due date (with retries), mark it past due, remind, and when the grace
 * period runs out with PAS as the delinquency source, record the account as delinquent.
 */
export function makeInstallmentTimers(
  deps: BillingEventDeps & {
    uow: UnitOfWork;
    schedules: BillingScheduleRepository;
    gateway: ProviderFor<PaymentGateway>;
    applyEvent: ApplyBillingEvent;
    notices: BillingNotices;
    clocks: ClockProvider;
  },
) {
  const load = (ctx: TenantContext, invoiceId: string) =>
    deps.uow.run(ctx, async (tx) => {
      const invoice = await deps.invoices.findById(tx, ctx, asId(invoiceId));
      const scheduleId = invoice?.toSnapshot().scheduleId;
      const schedule = scheduleId ? await deps.schedules.findById(tx, ctx, scheduleId) : null;

      return { invoice, schedule };
    });

  async function charge(ctx: TenantContext, invoice: Invoice, attempt: string): Promise<void> {
    const { schedule } = await load(ctx, invoice.id);
    const methodId = schedule?.isActive ? schedule.autopayMethodId : null;

    if (!methodId) return;

    const method = await deps.uow.run(ctx, (tx) =>
      deps.schedules.findPaymentMethod(tx, ctx, methodId),
    );

    if (!method || method.status !== "active") return;

    const gateway = await deps.gateway.for(ctx);
    const i = invoice.toSnapshot();
    const amount = invoice.balance;
    const clock = deps.clocks.forTenant(ctx.tenantId);

    const result = await gateway.chargeSaved(ctx, {
      reference: i.number,
      idempotencyKey: `${i.id}:${attempt}:${amount.toString()}`,
      amount,
      methodRef: method.providerRef,
      customerRef: method.customerRef,
    });

    const summary = { brand: method.brand, last4: method.last4 };

    await deps.applyEvent(
      ctx,
      result.status === "paid"
        ? {
            eventId: `${gateway.provider}:${result.paymentRef}`,
            source: "pas",
            type: "payment.received",
            occurredAt: clock.now(),
            invoiceId: i.id,
            amount,
            provider: gateway.provider,
            reference: result.paymentRef,
            method: summary,
            actor: { type: "system", name: "Autopay" },
          }
        : {
            eventId: `autopay:${i.id}:${attempt}`,
            source: "pas",
            type: "payment.failed",
            occurredAt: clock.now(),
            invoiceId: i.id,
            amount,
            provider: gateway.provider,
            method: summary,
            reason: result.message,
            actor: { type: "system", name: "Autopay" },
          },
    );
  }

  return {
    async steps(ctx: TenantContext, input: { invoiceId: string }): Promise<InstallmentStep[]> {
      const { invoice, schedule } = await load(ctx, input.invoiceId);

      if (!invoice || !schedule) return [];

      const i = invoice.toSnapshot();
      const { dunning, plan } = schedule.toSnapshot();
      const due = i.dueOn;

      const steps: InstallmentStep[] = [
        { id: "open", action: "open", on: i.issuedOn.toString() },
        { id: "charge", action: "charge", on: due.toString() },
        { id: "past-due", action: "past_due", on: due.add({ days: 1 }).toString() },
        ...Array.from({ length: dunning.retries }, (_, k) => ({
          id: `retry-${k + 1}`,
          action: "retry" as const,
          on: due.add({ days: dunning.retryAfterDays * (k + 1) }).toString(),
        })),
        ...(dunning.reminderAfterDays > 0
          ? [
              {
                id: "remind",
                action: "remind" as const,
                on: due.add({ days: dunning.reminderAfterDays }).toString(),
              },
            ]
          : []),
        ...(dunning.delinquencySource === "pas"
          ? [
              {
                id: "delinquent",
                action: "delinquent" as const,
                on: due.add({ days: Math.max(1, plan.graceDays) }).toString(),
              },
            ]
          : []),
      ];

      return steps
        .map((step, order) => ({ step, order }))
        .toSorted((a, b) => a.step.on.localeCompare(b.step.on) || a.order - b.order)
        .map(({ step }) => step);
    },

    msUntil(ctx: TenantContext, on: string): number {
      const at = Temporal.PlainDate.from(on).toZonedDateTime("UTC").toInstant();

      return Math.max(0, deps.clocks.forTenant(ctx.tenantId).now().until(at).total("milliseconds"));
    },

    async describe(ctx: TenantContext, input: { invoiceId: string }) {
      const { invoice } = await load(ctx, input.invoiceId);

      return (
        invoice && {
          number: invoice.toSnapshot().number,
          policyNumber: invoice.toSnapshot().policyNumber,
        }
      );
    },

    /** Runs one step; `done` once the installment is settled and nothing more can happen. */
    async run(
      ctx: TenantContext,
      input: { invoiceId: string; step: InstallmentStep },
    ): Promise<{ done: boolean; status: string }> {
      const { invoice } = await load(ctx, input.invoiceId);
      const clock = deps.clocks.forTenant(ctx.tenantId);

      if (!invoice) return { done: true, status: "missing" };

      const i = invoice.toSnapshot();

      switch (input.step.action) {
        case "open": {
          await deps.uow.run(ctx, async (tx) => {
            const current = (await deps.invoices.findById(tx, ctx, invoice.id))!;

            if (!current.open(clock)) return;

            await deps.invoices.save(tx, current);

            await deps.timeline.record(tx, ctx, {
              policyId: i.policyId,
              invoiceId: i.id,
              type: "invoice_issued",
              actor: SYSTEM,
              summary: `Installment ${i.installment} of ${i.installments}, ${i.number}, issued for ${formatMoney(current.balance)} due ${formatDate(i.dueOn)}`,
              data: {
                invoiceNumber: i.number,
                total: i.total.toJSON(),
                kind: i.kind,
                installment: i.installment,
              },
            });
          });

          break;
        }
        case "charge":
        case "retry": {
          if (!settled(invoice)) await charge(ctx, invoice, input.step.id);

          break;
        }
        case "past_due": {
          await deps.uow.run(ctx, async (tx) => {
            const current = (await deps.invoices.findById(tx, ctx, invoice.id))!;

            if (!current.markPastDue(clock)) return;

            await deps.invoices.save(tx, current);

            await deps.timeline.record(tx, ctx, {
              policyId: i.policyId,
              invoiceId: i.id,
              type: "past_due",
              actor: SYSTEM,
              summary: `${i.number} is past due: ${formatMoney(current.balance)} was due ${formatDate(i.dueOn)}`,
              data: {
                invoiceNumber: i.number,
                amount: current.balance.toJSON(),
                dueOn: i.dueOn.toString(),
              },
            });
          });

          break;
        }
        case "remind": {
          if (settled(invoice)) break;

          const sentTo = await deps.notices.remind(ctx, {
            policyId: i.policyId,
            policyNumber: i.policyNumber,
            subject: `Your payment for policy ${i.policyNumber} is past due`,
            text: `${formatMoney(invoice.balance)} for policy ${i.policyNumber} (${i.number}) was due on ${formatDate(i.dueOn)}. Pay now in your client portal to keep your coverage in force.`,
          });

          await deps.uow.run(ctx, (tx) =>
            deps.timeline.record(tx, ctx, {
              policyId: i.policyId,
              invoiceId: i.id,
              type: "payment_reminder",
              actor: SYSTEM,
              summary: sentTo.length
                ? `Payment reminder for ${i.number} emailed to ${sentTo.join(", ")}`
                : `Payment reminder for ${i.number} not sent: no email on file`,
              data: { invoiceNumber: i.number, recipients: sentTo },
            }),
          );

          break;
        }
        case "delinquent": {
          if (settled(invoice) || invoice.status !== "past_due") break;

          const pastDue = await deps.uow.run(ctx, async (tx) =>
            pastDueOf(await deps.invoices.listByPolicy(tx, ctx, i.policyId)),
          );

          await deps.applyEvent(ctx, {
            eventId: `delinquent:${i.id}`,
            source: "pas",
            type: "account.delinquent",
            occurredAt: clock.now(),
            invoiceId: i.id,
            ...(pastDue && { amount: pastDue }),
            actor: SYSTEM,
          });

          break;
        }
      }

      const { invoice: after } = await load(ctx, input.invoiceId);

      return { done: settled(after), status: after?.status ?? "missing" };
    },
  };
}

export type InstallmentTimers = ReturnType<typeof makeInstallmentTimers>;
