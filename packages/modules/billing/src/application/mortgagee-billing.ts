import {
  asId,
  type ClockProvider,
  formatMoney,
  formatPlainDate,
  newId,
  notFound,
  type PlainDate,
  type TenantContext,
  type Transaction,
  type UnitOfWork,
} from "@pas/kernel";
import { mortgageeFollowUps, type MortgageeStepAction } from "@pas/pay-plans";
import type { ObjectStorage } from "@pas/storage";
import { INSURED } from "../domain/billing-schedule";
import type { Invoice } from "../domain/invoice";
import type { Lender, MortgageeBill } from "../domain/mortgagee-bill";
import type { BillingDocuments } from "../ports/billing-documents";
import type { BillingMail } from "../ports/billing-mail";
import type { BillingScheduleRepository } from "../ports/billing-schedule-repository";
import type { MortgageeBillRepository } from "../ports/mortgagee-bill-repository";
import { type ApplyBillingEvent, type BillingEventDeps } from "./apply-billing-event";

type Deps = BillingEventDeps & {
  uow: UnitOfWork;
  schedules: BillingScheduleRepository;
  mortgageeBills: MortgageeBillRepository;
  documents: BillingDocuments;
  mail: BillingMail;
  storage: ObjectStorage;
  applyEvent: ApplyBillingEvent;
  clocks: ClockProvider;
};

const SYSTEM = { type: "system" as const, name: "Billing" };

const loanOf = (lender: Lender) => (lender.loanNumber ? ` · Loan ${lender.loanNumber}` : "");

export interface MortgageeStatusDto {
  id: string;
  status: MortgageeBill["status"];
  lender: { name: string; loanNumber: string | null; address: unknown; email: string | null };
  sentOn: string | null;
  history: { kind: string; on: string; summary: string }[];
  next: { action: MortgageeStepAction; on: string } | null;
  canSwitchToDirect: boolean;
}

export function toMortgageeStatusDto(bill: MortgageeBill, today: PlainDate): MortgageeStatusDto {
  const b = bill.toSnapshot();

  const next = b.sentOn
    ? mortgageeFollowUps(b.followUp, b.sentOn).find(
        (s) => Temporal.PlainDate.compare(s.on, today) > 0,
      )
    : undefined;

  return {
    id: b.id,
    status: b.status,
    lender: b.lender,
    sentOn: b.sentOn?.toString() ?? null,
    history: b.history,
    next: bill.isOpen && next ? { action: next.action, on: next.on.toString() } : null,
    canSwitchToDirect: bill.isOpen,
  };
}

/**
 * Mortgagee bill (PLAN §13): the lender gets an invoice packet by mail (and email), reminders on
 * the configured days, the insured is offered direct bill, and unpaid bills start nonpayment.
 */
export function makeMortgageeBilling(deps: Deps) {
  const clockOf = (ctx: TenantContext) => deps.clocks.forTenant(ctx.tenantId);
  const today = (ctx: TenantContext) => clockOf(ctx).today("UTC");

  const load = (ctx: TenantContext, id: string) =>
    deps.uow.run(ctx, async (tx) => {
      const bill = await deps.mortgageeBills.findById(tx, ctx, id);

      if (!bill) throw notFound("Mortgagee bill", id);

      const invoice = await deps.invoices.findById(tx, ctx, asId(bill.toSnapshot().invoiceId));

      return { bill, invoice: invoice! };
    });

  const update = (
    ctx: TenantContext,
    id: string,
    change: (bill: MortgageeBill, tx: Transaction) => Promise<void> | void,
  ) =>
    deps.uow.run(ctx, async (tx) => {
      const bill = (await deps.mortgageeBills.findById(tx, ctx, id))!;

      await change(bill, tx);
      await deps.mortgageeBills.save(tx, ctx, bill);
      await deps.outbox.add(tx, bill.pullEvents());
    });

  async function mailLender(
    ctx: TenantContext,
    bill: MortgageeBill,
    invoice: Invoice,
    reminder: boolean,
  ): Promise<string> {
    const b = bill.toSnapshot();
    const i = invoice.toSnapshot();
    const title = reminder ? "Premium reminder" : "Mortgagee invoice packet";

    const pdf = await deps.documents.mortgageePacket(ctx, {
      title,
      lender: { name: b.lender.name, loanNumber: b.lender.loanNumber, address: b.lender.address },
      invoice: {
        number: i.number,
        issuedOn: i.issuedOn.toString(),
        dueOn: i.dueOn.toString(),
        total: invoice.balance.toJSON(),
      },
      policyId: b.policyId,
      reminder,
    });

    const key = `tenants/${ctx.tenantId}/billing/mortgagee/${b.id}/${newId()}.pdf`;

    await deps.storage.put({ key, body: pdf, contentType: "application/pdf" });

    const sent: string[] = [];

    if (b.lender.address) {
      const letter = await deps.mail.letter(ctx, {
        policyId: b.policyId,
        transactionId: i.transactionId,
        title: `${title}, ${i.number}`,
        pdf,
        to: { name: b.lender.name, address: b.lender.address },
      });

      sent.push(
        letter.mailed
          ? `mailed${letter.trackingNumber ? ` (tracking ${letter.trackingNumber})` : ""}`
          : "sent to print",
      );
    }

    if (b.lender.email) {
      await deps.mail.email(ctx, {
        to: b.lender.email,
        tag: "mortgagee_invoice",
        subject: `${title}: policy ${b.policyNumber}${loanOf(b.lender)}`,
        text: `${formatMoney(invoice.balance)} is due by ${formatPlainDate(i.dueOn)} for policy ${b.policyNumber} (${i.number})${b.lender.loanNumber ? `, loan ${b.lender.loanNumber}` : ""}. The invoice, evidence of insurance and declarations are attached to the mailed packet.`,
      });

      sent.push(`emailed to ${b.lender.email}`);
    }

    return sent.length ? sent.join(" and ") : "not sent: no address or email for the lender";
  }

  return {
    /** Sends the invoice packet to the lender; returns the day it went out. */
    async sendPacket(
      ctx: TenantContext,
      input: { mortgageeBillId: string },
    ): Promise<string | null> {
      const { bill, invoice } = await load(ctx, input.mortgageeBillId);

      if (bill.status !== "awaiting_packet") return bill.toSnapshot().sentOn?.toString() ?? null;

      const how = await mailLender(ctx, bill, invoice, false);
      const on = today(ctx);
      const b = bill.toSnapshot();
      const summary = `Mortgagee invoice packet (invoice, evidence of insurance, declarations) for ${invoice.toSnapshot().number} ${how}: ${b.lender.name}${loanOf(b.lender)}`;

      await update(ctx, b.id, async (current, tx) => {
        current.packetSent(on, summary, clockOf(ctx));

        await deps.timeline.record(tx, ctx, {
          policyId: b.policyId,
          invoiceId: b.invoiceId,
          type: "mortgagee_packet_sent",
          actor: SYSTEM,
          summary,
          data: { mortgageeBillId: b.id, lender: b.lender.name, loanNumber: b.lender.loanNumber },
        });
      });

      return on.toString();
    },

    async steps(ctx: TenantContext, input: { mortgageeBillId: string }) {
      const { bill } = await load(ctx, input.mortgageeBillId);
      const b = bill.toSnapshot();

      if (!b.sentOn) return [];

      return mortgageeFollowUps(b.followUp, b.sentOn).map((s) => ({ ...s, on: s.on.toString() }));
    },

    async describe(ctx: TenantContext, input: { mortgageeBillId: string }) {
      const bill = await deps.uow.run(ctx, (tx) =>
        deps.mortgageeBills.findById(tx, ctx, input.mortgageeBillId),
      );

      return (
        bill && {
          policyNumber: bill.toSnapshot().policyNumber,
          lender: bill.toSnapshot().lender.name,
        }
      );
    },

    /** One follow-up; `done` once there's nothing more to chase. */
    async run(
      ctx: TenantContext,
      input: { mortgageeBillId: string; action: MortgageeStepAction; sentOn: string },
    ): Promise<{ done: boolean; status: string }> {
      const { bill, invoice } = await load(ctx, input.mortgageeBillId);
      const b = bill.toSnapshot();
      const i = invoice.toSnapshot();
      const unpaid = invoice.isUnpaid && invoice.balance.amount.greaterThan(0);

      if (b.sentOn?.toString() !== input.sentOn) return { done: true, status: "superseded" };

      if (!unpaid) {
        await update(ctx, b.id, (current) => {
          current.markPaid(today(ctx), clockOf(ctx));
        });

        return { done: true, status: "paid" };
      }

      switch (input.action) {
        case "remind_lender": {
          if (!bill.lenderPays) break;

          const how = await mailLender(ctx, bill, invoice, true);
          const summary = `Premium reminder for ${i.number} ${how}: ${b.lender.name}${loanOf(b.lender)}`;

          await update(ctx, b.id, async (current, tx) => {
            current.note("reminder_sent", today(ctx), summary, clockOf(ctx));

            await deps.timeline.record(tx, ctx, {
              policyId: b.policyId,
              invoiceId: b.invoiceId,
              type: "mortgagee_reminder",
              actor: SYSTEM,
              summary,
              data: { mortgageeBillId: b.id },
            });
          });

          break;
        }
        case "offer_direct": {
          if (!bill.lenderPays) break;

          const link = await deps.mail.links.policyBilling(ctx, b.policyId);
          const to = await deps.mail.insuredEmails(ctx, b.policyId);

          for (const address of to) {
            await deps.mail.email(ctx, {
              to: address,
              tag: "direct_bill_offer",
              subject: `Your lender hasn't paid the premium for policy ${b.policyNumber}`,
              text: `We billed ${b.lender.name} ${formatMoney(invoice.balance)} for policy ${b.policyNumber} on ${formatPlainDate(b.sentOn!)} and haven't received it. Ask your lender to pay, or pay it yourself to keep your coverage: ${link}`,
            });
          }

          const summary = to.length
            ? `Insured told the lender hasn't paid and offered direct bill: emailed ${to.join(", ")}`
            : "Lender hasn't paid; insured not emailed (no email on file). Offer direct bill by phone or mail.";

          await update(ctx, b.id, async (current, tx) => {
            current.note("insured_offered_direct", today(ctx), summary, clockOf(ctx));

            await deps.timeline.record(tx, ctx, {
              policyId: b.policyId,
              invoiceId: b.invoiceId,
              type: "direct_bill_offered",
              actor: SYSTEM,
              summary,
              data: { mortgageeBillId: b.id, recipients: to },
            });
          });

          break;
        }
        case "nonpayment": {
          await deps.uow.run(ctx, async (tx) => {
            const current = (await deps.invoices.findById(tx, ctx, asId(i.id)))!;

            if (current.markPastDue(clockOf(ctx))) await deps.invoices.save(tx, current);
          });

          await update(ctx, b.id, (current) => {
            current.startNonpayment(today(ctx), clockOf(ctx));
          });

          await deps.applyEvent(ctx, {
            eventId: `mortgagee-delinquent:${b.id}:${input.sentOn}`,
            source: "pas",
            type: "account.delinquent",
            occurredAt: clockOf(ctx).now(),
            invoiceId: i.id,
            amount: invoice.balance,
            reason: `${b.lender.name} didn't pay ${i.number}`,
            actor: SYSTEM,
          });

          return { done: true, status: "nonpayment" };
        }
      }

      return { done: false, status: bill.status };
    },

    /**
     * The insured takes over a lender's unpaid bill: the open invoice is re-issued to them, due
     * when nonpayment would start, and they get a pay link.
     */
    async switchToDirect(
      ctx: TenantContext,
      input: {
        policyId: string;
        actor: { type: "user" | "system" | "api"; id?: string; name: string };
      },
    ): Promise<MortgageeStatusDto> {
      const clock = clockOf(ctx);

      const switched = await deps.uow.run(ctx, async (tx) => {
        const bill = await deps.mortgageeBills.latestForPolicy(tx, ctx, input.policyId);

        if (!bill) throw notFound("Mortgagee bill for policy", input.policyId);

        const b = bill.toSnapshot();
        const invoice = (await deps.invoices.findById(tx, ctx, asId(b.invoiceId)))!;
        const schedule = await deps.schedules.findByTerm(tx, ctx, b.termId);
        const sentOn = b.sentOn ?? today(ctx);
        const dueOn = sentOn.add({ days: b.followUp.nonpaymentAfterDays });

        bill.switchToDirect(today(ctx), input.actor.name, clock);
        invoice.reassign(INSURED, dueOn, clock);
        schedule?.switchToDirect(clock);

        await deps.invoices.save(tx, invoice);

        if (schedule) await deps.schedules.save(tx, schedule);

        await deps.mortgageeBills.save(tx, ctx, bill);
        await deps.outbox.add(tx, bill.pullEvents());

        await deps.outbox.add(tx, [
          {
            id: newId(),
            type: "billing.billing_method_changed",
            tenantId: ctx.tenantId,
            aggregateType: "billing_schedule",
            aggregateId: schedule?.id ?? b.id,
            occurredAt: clock.now(),
            payload: { policyId: b.policyId, termId: b.termId, billingMethod: "direct" },
          },
        ]);

        await deps.timeline.record(tx, ctx, {
          policyId: b.policyId,
          invoiceId: b.invoiceId,
          type: "billing_method_changed",
          actor: input.actor,
          summary: `Billing switched from ${b.lender.name} to direct bill: ${invoice.toSnapshot().number} re-issued to the insured for ${formatMoney(invoice.balance)}, due ${formatPlainDate(dueOn)}`,
          data: { from: "mortgagee", to: "direct", invoiceNumber: invoice.toSnapshot().number },
        });

        return { bill, invoice };
      });

      const b = switched.bill.toSnapshot();
      const link = await deps.mail.links.policyBilling(ctx, b.policyId);

      for (const to of await deps.mail.insuredEmails(ctx, b.policyId)) {
        await deps.mail.email(ctx, {
          to,
          tag: "direct_bill_invoice",
          subject: `Your invoice for policy ${b.policyNumber}`,
          text: `Your policy ${b.policyNumber} is now billed to you: ${formatMoney(switched.invoice.balance)} (${switched.invoice.toSnapshot().number}) is due by ${formatPlainDate(switched.invoice.toSnapshot().dueOn)}. Pay online: ${link}`,
        });
      }

      return toMortgageeStatusDto(switched.bill, today(ctx));
    },

    /** A mortgagee change on the policy: the open bill moves to the new lender and the packet goes again. */
    async changeLender(ctx: TenantContext, input: { policyId: string; lender: Lender }) {
      return deps.uow.run(ctx, async (tx) => {
        const bill = await deps.mortgageeBills.latestForPolicy(tx, ctx, input.policyId);

        if (!bill?.changeLender(input.lender, today(ctx), clockOf(ctx))) return false;

        const b = bill.toSnapshot();
        const invoice = (await deps.invoices.findById(tx, ctx, asId(b.invoiceId)))!;
        const schedule = await deps.schedules.findByTerm(tx, ctx, b.termId);

        const payer = {
          payer: "mortgagee" as const,
          payerRef: input.lender.loanNumber,
          payerName: input.lender.name,
          payerAddress: input.lender.address,
        };

        invoice.reassign(payer, invoice.toSnapshot().dueOn, clockOf(ctx));
        schedule?.changePayer(payer, clockOf(ctx));
        await deps.invoices.save(tx, invoice);

        if (schedule) await deps.schedules.save(tx, schedule);

        await deps.mortgageeBills.save(tx, ctx, bill);
        await deps.outbox.add(tx, bill.pullEvents());

        return true;
      });
    },

    async forPolicy(ctx: TenantContext, input: { policyId: string }) {
      const bill = await deps.uow.run(ctx, (tx) =>
        deps.mortgageeBills.latestForPolicy(tx, ctx, input.policyId),
      );

      return bill && toMortgageeStatusDto(bill, today(ctx));
    },
  };
}

export type MortgageeBilling = ReturnType<typeof makeMortgageeBilling>;
