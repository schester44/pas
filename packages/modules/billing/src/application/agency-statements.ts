import {
  asId,
  type ClockProvider,
  Money,
  newId,
  notFound,
  type PlainDate,
  parsePlainDate,
  type TenantContext,
  type UnitOfWork,
} from "@pas/kernel";
import type { ObjectStorage } from "@pas/storage";
import {
  AgencyStatement,
  openOf,
  type StatementItem,
  type StatementLine,
  type StatementStatus,
} from "../domain/agency-statement";
import type { Invoice } from "../domain/invoice";
import { type AgingAction, agingSteps, cutoffOnOrAfter } from "../domain/statement-cycle";
import type { AgencyDirectory, AgencyTerms } from "../ports/agency-directory";
import type { AgencyStatementRepository } from "../ports/agency-statement-repository";
import type { BillingDocuments } from "../ports/billing-documents";
import type { BillingMail } from "../ports/billing-mail";
import {
  applyBillingEventIn,
  type ApplyBillingEvent,
  type BillingEventDeps,
  formatMoney,
} from "./apply-billing-event";

type MoneyDto = { amount: string; currency: string };

/** What billing needs to know about the policy transactions it bills. */
export interface BilledTransactions {
  describe(
    ctx: TenantContext,
    input: { policyId: string; transactionId: string },
  ): Promise<{ type: string; effectiveDate: string; insuredName: string }>;
}

export interface AgencyStatementDto {
  id: string;
  number: string;
  agencyId: string;
  agencyName: string;
  periodStart: string;
  periodEnd: string;
  issuedOn: string;
  dueOn: string;
  remittanceBasis: "gross" | "net";
  status: StatementStatus;
  remindedOn: string | null;
  suspendedOn: string | null;
  hasDocument: boolean;
  emailedTo: string[];
  totals: {
    gross: MoneyDto;
    commission: MoneyDto;
    net: MoneyDto;
    due: MoneyDto;
    paid: MoneyDto;
    balance: MoneyDto;
  };
  items: {
    id: string;
    invoiceId: string;
    invoiceNumber: string;
    kind: "invoice" | "credit_note";
    policyId: string;
    policyNumber: string;
    insuredName: string;
    transactionType: string;
    effectiveDate: string;
    gross: MoneyDto;
    commission: MoneyDto;
    net: MoneyDto;
    due: MoneyDto;
    credited: MoneyDto;
    paid: MoneyDto;
    open: MoneyDto;
  }[];
}

type Deps = BillingEventDeps & {
  uow: UnitOfWork;
  statements: AgencyStatementRepository;
  agencies: AgencyDirectory;
  transactions: BilledTransactions;
  documents: BillingDocuments;
  mail: BillingMail;
  storage: ObjectStorage;
  applyEvent: ApplyBillingEvent;
  clocks: ClockProvider;
};

const SYSTEM = { type: "system" as const, name: "Billing" };

const TRANSACTION_LABELS: Record<string, string> = {
  NEW_BUSINESS: "New business",
  ENDORSEMENT: "Endorsement",
  CANCELLATION: "Cancellation",
  REINSTATEMENT: "Reinstatement",
  CANCELLATION_RESCISSION: "Rescission",
  RENEWAL: "Renewal",
};

const transactionLabel = (type: string) => TRANSACTION_LABELS[type] ?? type.replaceAll("_", " ");

const formatDate = (date: PlainDate) =>
  date.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" });

export function toStatementDto(statement: AgencyStatement): AgencyStatementDto {
  const s = statement.toSnapshot();
  const t = statement.totals;

  return {
    id: s.id,
    number: s.number,
    agencyId: s.agencyId,
    agencyName: s.agencyName,
    periodStart: s.periodStart.toString(),
    periodEnd: s.periodEnd.toString(),
    issuedOn: s.issuedOn.toString(),
    dueOn: s.dueOn.toString(),
    remittanceBasis: s.remittanceBasis,
    status: s.status,
    remindedOn: s.remindedOn?.toString() ?? null,
    suspendedOn: s.suspendedOn?.toString() ?? null,
    hasDocument: s.documentKey !== null,
    emailedTo: s.emailedTo,
    totals: {
      gross: t.gross.toJSON(),
      commission: t.commission.toJSON(),
      net: t.net.toJSON(),
      due: t.due.toJSON(),
      paid: t.paid.toJSON(),
      balance: t.balance.toJSON(),
    },
    items: s.items.map((i: StatementItem) => ({
      id: i.id,
      invoiceId: i.invoiceId,
      invoiceNumber: i.invoiceNumber,
      kind: i.invoiceKind,
      policyId: i.policyId,
      policyNumber: i.policyNumber,
      insuredName: i.insuredName,
      transactionType: i.transactionType,
      effectiveDate: i.effectiveDate.toString(),
      gross: i.gross.toJSON(),
      commission: i.commission.toJSON(),
      net: i.net.toJSON(),
      due: i.due.toJSON(),
      credited: i.credited.toJSON(),
      paid: i.paid.toJSON(),
      open: openOf(i).toJSON(),
    })),
  };
}

/**
 * Agency bill (PLAN §13): a monthly account current per agency from its agency-billed invoices,
 * the statement PDF emailed to the agency, and aging that suspends the agency-bill privilege.
 */
export function makeAgencyStatements(deps: Deps) {
  const today = (ctx: TenantContext) => deps.clocks.forTenant(ctx.tenantId).today("UTC");

  const load = async (ctx: TenantContext, id: string) => {
    const statement = await deps.uow.run(ctx, (tx) => deps.statements.findById(tx, ctx, id));

    if (!statement) throw notFound("Agency statement", id);

    return statement;
  };

  async function netReturns(
    ctx: TenantContext,
    tx: Parameters<typeof applyBillingEventIn>[1],
    statement: AgencyStatement,
    invoices: Map<string, Invoice>,
  ) {
    const clock = deps.clocks.forTenant(ctx.tenantId);
    const debits = statement.items.filter((i) => i.invoiceKind === "invoice");

    for (const credit of statement.items.filter(
      (i) => i.invoiceKind === "credit_note" && i.credited.amount.greaterThan(0),
    )) {
      const note = invoices.get(credit.invoiceId)!;
      let available = note.balance.negated();

      for (const debit of debits) {
        if (!available.amount.greaterThan(0)) break;

        const invoice = await deps.invoices.findById(tx, ctx, asId(debit.invoiceId));

        if (!invoice?.isUnpaid) continue;

        const take = available.amount.lessThan(invoice.balance.amount)
          ? available
          : invoice.balance;

        if (!take.amount.greaterThan(0)) continue;

        await applyBillingEventIn(deps, tx, ctx, {
          eventId: `statement:${statement.id}:net:${credit.invoiceId}:${debit.invoiceId}`,
          source: "pas",
          quiet: true,
          type: "credit.applied",
          occurredAt: clock.now(),
          invoiceId: debit.invoiceId,
          creditNoteId: credit.invoiceId,
          amount: take,
          actor: SYSTEM,
        });

        available = available.minus(take);
      }
    }
  }

  async function notifyAgency(
    ctx: TenantContext,
    terms: AgencyTerms,
    subject: string,
    text: string,
    tag: string,
  ) {
    for (const to of terms.contacts) await deps.mail.email(ctx, { to, subject, text, tag });

    return terms.contacts;
  }

  return {
    /** The cut-off of the statement that will carry an agency invoice issued now. */
    async cutoffFor(ctx: TenantContext, input: { agencyId: string }): Promise<string> {
      const terms = await deps.agencies.terms(ctx, input);

      return cutoffOnOrAfter(today(ctx), terms.statementDay).toString();
    },

    /** Issues the account current for the period ending at the cut-off; null when nothing's due. */
    async generate(
      ctx: TenantContext,
      input: { agencyId: string; cutoff: string },
    ): Promise<string | null> {
      const cutoff = parsePlainDate(input.cutoff);
      const terms = await deps.agencies.terms(ctx, input);

      const { existing, invoices, previous } = await deps.uow.run(ctx, async (tx) => {
        const found = await deps.statements.findByPeriod(tx, ctx, input.agencyId, cutoff);

        const ids = found
          ? []
          : await deps.statements.unstatemented(tx, ctx, input.agencyId, cutoff);

        const loaded = await Promise.all(
          ids.map((id) => deps.invoices.findById(tx, ctx, asId(id))),
        );

        return {
          existing: found,
          invoices: loaded.filter((i): i is Invoice => i !== null),
          previous: await deps.statements.latestFor(tx, ctx, input.agencyId),
        };
      });

      if (existing) return existing.id;

      if (invoices.length === 0) return null;

      const snapshots = invoices.map((i) => i.toSnapshot());
      const transactionIds = [...new Set(snapshots.map((i) => i.transactionId))];
      const commissions = await deps.agencies.commissions(ctx, { transactionIds });

      const described = new Map(
        await Promise.all(
          snapshots.map(
            async (i) =>
              [
                i.transactionId,
                await deps.transactions.describe(ctx, {
                  policyId: i.policyId,
                  transactionId: i.transactionId,
                }),
              ] as const,
          ),
        ),
      );

      const currency = snapshots[0]!.total.currency;

      const lines: StatementLine[] = snapshots.map((i) => {
        const transaction = described.get(i.transactionId)!;

        return {
          invoiceId: i.id,
          invoiceNumber: i.number,
          invoiceKind: i.kind,
          policyId: i.policyId,
          policyNumber: i.policyNumber,
          insuredName: transaction.insuredName,
          transactionId: i.transactionId,
          transactionType: transaction.type,
          effectiveDate: parsePlainDate(transaction.effectiveDate),
          gross: i.total,
          commission: Money.zero(currency),
        };
      });

      const commissionOf = (line: StatementLine) => {
        const recorded = commissions[line.transactionId];

        return recorded ? Money.of(recorded.amount, recorded.currency) : Money.zero(currency);
      };

      const earliest = snapshots.map((i) => i.issuedOn).toSorted(Temporal.PlainDate.compare)[0]!;

      return deps.uow.run(ctx, async (tx) => {
        const raced = await deps.statements.findByPeriod(tx, ctx, input.agencyId, cutoff);

        if (raced) return raced.id;

        const clock = deps.clocks.forTenant(ctx.tenantId);
        const sequence = await deps.statements.nextSequence(tx, ctx);

        const statement = AgencyStatement.issue(
          {
            tenantId: ctx.tenantId,
            agencyId: input.agencyId,
            agencyName: terms.name,
            number: `AC-${String(sequence).padStart(5, "0")}`,
            periodStart: previous ? previous.toSnapshot().periodEnd.add({ days: 1 }) : earliest,
            periodEnd: cutoff,
            issuedOn: today(ctx),
            dueOn: cutoff.add({ days: terms.remittanceDays }),
            remittanceBasis: terms.remittanceBasis,
            currency,
            lines,
            commissionOf,
          },
          clock,
        );

        await deps.statements.save(tx, ctx, statement);
        await netReturns(ctx, tx, statement, new Map(invoices.map((i) => [i.id as string, i])));

        const s = statement.toSnapshot();

        for (const item of s.items.filter((i) => i.invoiceKind === "invoice")) {
          const invoice = await deps.invoices.findById(tx, ctx, asId(item.invoiceId));

          if (!invoice) continue;

          invoice.dueBy(s.dueOn, clock);
          await deps.invoices.save(tx, invoice);
        }

        for (const item of s.items) {
          await deps.timeline.record(tx, ctx, {
            policyId: item.policyId,
            invoiceId: item.invoiceId,
            type: "statement_issued",
            actor: SYSTEM,
            summary: `${item.invoiceNumber} billed to ${s.agencyName} on account current ${s.number} (${formatMoney(item.due)}${s.remittanceBasis === "net" ? " net of commission" : ""}), due ${formatDate(s.dueOn)}`,
            data: {
              statementId: s.id,
              statementNumber: s.number,
              agencyId: s.agencyId,
              due: item.due.toJSON(),
              dueOn: s.dueOn.toString(),
            },
          });
        }

        return statement.id;
      });
    },

    /** Renders the statement PDF, stores it and emails the agency. Idempotent. */
    async publish(ctx: TenantContext, input: { statementId: string }): Promise<void> {
      const statement = await load(ctx, input.statementId);
      const s = statement.toSnapshot();

      if (s.documentKey) return;

      const terms = await deps.agencies.terms(ctx, { agencyId: s.agencyId });
      const t = statement.totals;

      const pdf = await deps.documents.statement(ctx, {
        number: s.number,
        agency: { name: s.agencyName, address: terms.address },
        periodStart: s.periodStart.toString(),
        periodEnd: s.periodEnd.toString(),
        issuedOn: s.issuedOn.toString(),
        dueOn: s.dueOn.toString(),
        remittanceBasis: s.remittanceBasis,
        items: s.items.map((i) => ({
          policyNumber: i.policyNumber,
          insuredName: i.insuredName,
          transaction: transactionLabel(i.transactionType),
          effectiveDate: i.effectiveDate.toString(),
          gross: i.gross.toJSON(),
          commission: i.commission.toJSON(),
          net: i.net.toJSON(),
          due: i.due.toJSON(),
        })),
        totals: {
          gross: t.gross.toJSON(),
          commission: t.commission.toJSON(),
          net: t.net.toJSON(),
          due: t.due.toJSON(),
        },
      });

      const key = `tenants/${ctx.tenantId}/billing/statements/${s.id}.pdf`;

      await deps.storage.put({ key, body: pdf, contentType: "application/pdf" });

      const link = await deps.mail.links.agencyStatements(ctx);

      const sentTo = await notifyAgency(
        ctx,
        terms,
        `Account current ${s.number}: ${formatMoney(t.due)} due ${formatDate(s.dueOn)}`,
        `Your account current ${s.number} for ${formatDate(s.periodStart)} – ${formatDate(s.periodEnd)} is ready: ${s.items.length} ${s.items.length === 1 ? "item" : "items"}, gross ${formatMoney(t.gross)}, commission ${formatMoney(t.commission)}, ${formatMoney(t.due)} due by ${formatDate(s.dueOn)}${s.remittanceBasis === "net" ? " (net of commission)" : ""}. View and download it at ${link}.`,
        "agency_statement",
      );

      await deps.uow.run(ctx, async (tx) => {
        const current = (await deps.statements.findById(tx, ctx, s.id))!;

        current.attachDocument(key, sentTo, deps.clocks.forTenant(ctx.tenantId));
        await deps.statements.save(tx, ctx, current);
      });
    },

    async agingPlan(ctx: TenantContext, input: { statementId: string }) {
      const statement = await load(ctx, input.statementId);
      const terms = await deps.agencies.terms(ctx, { agencyId: statement.toSnapshot().agencyId });

      return agingSteps(statement.toSnapshot().dueOn, terms).map((step) => ({
        ...step,
        on: step.on.toString(),
      }));
    },

    /** One aging step; `done` once the statement is settled. */
    async age(
      ctx: TenantContext,
      input: { statementId: string; action: AgingAction },
    ): Promise<{ done: boolean; status: string }> {
      const statement = await load(ctx, input.statementId);
      const s = statement.toSnapshot();
      const clock = deps.clocks.forTenant(ctx.tenantId);

      if (statement.isSettled) return { done: true, status: s.status };

      const terms = await deps.agencies.terms(ctx, { agencyId: s.agencyId });
      const balance = formatMoney(statement.totals.balance);

      const save = (change: (current: AgencyStatement) => void) =>
        deps.uow.run(ctx, async (tx) => {
          const current = (await deps.statements.findById(tx, ctx, s.id))!;

          change(current);
          await deps.statements.save(tx, ctx, current);
        });

      switch (input.action) {
        case "past_due": {
          await save((current) => current.markPastDue(clock));
          break;
        }
        case "remind": {
          await notifyAgency(
            ctx,
            terms,
            `Account current ${s.number} is past due`,
            `${balance} on account current ${s.number} was due ${formatDate(s.dueOn)}. Please remit it now to keep agency billing.`,
            "agency_statement_reminder",
          );

          await save((current) => current.remind(today(ctx), clock));
          break;
        }
        case "suspend": {
          await save((current) => {
            current.markPastDue(clock);
            current.suspend(today(ctx), clock);
          });

          await deps.uow.run(ctx, (tx) =>
            deps.outbox.add(tx, [
              {
                id: newId(),
                type: "billing.agency_bill_delinquent",
                tenantId: ctx.tenantId,
                aggregateType: "agency_statement",
                aggregateId: s.id,
                occurredAt: clock.now(),
                payload: {
                  statementId: s.id,
                  agencyId: s.agencyId,
                  reason: `Account current ${s.number} unpaid: ${balance} past due since ${formatDate(s.dueOn)}`,
                },
              },
            ]),
          );

          if (terms.nonpaymentCancels) {
            for (const item of statement.items.filter((i) => openOf(i).amount.greaterThan(0))) {
              await deps.uow.run(ctx, async (tx) => {
                const invoice = await deps.invoices.findById(tx, ctx, asId(item.invoiceId));

                if (invoice?.markPastDue(clock)) await deps.invoices.save(tx, invoice);
              });

              await deps.applyEvent(ctx, {
                eventId: `agency-delinquent:${s.id}:${item.invoiceId}`,
                source: "pas",
                type: "account.delinquent",
                occurredAt: clock.now(),
                invoiceId: item.invoiceId,
                amount: openOf(item),
                reason: `Unpaid on account current ${s.number}`,
                actor: SYSTEM,
              });
            }
          }

          break;
        }
      }

      const after = await load(ctx, s.id);

      return { done: after.isSettled, status: after.status };
    },

    async describe(ctx: TenantContext, input: { statementId: string }) {
      const statement = await deps.uow.run(ctx, (tx) =>
        deps.statements.findById(tx, ctx, input.statementId),
      );

      return (
        statement && {
          number: statement.toSnapshot().number,
          agencyName: statement.toSnapshot().agencyName,
        }
      );
    },

    async list(
      ctx: TenantContext,
      input: { agencyIds?: readonly string[]; statuses?: readonly StatementStatus[] },
    ): Promise<AgencyStatementDto[]> {
      const rows = await deps.uow.run(ctx, (tx) =>
        deps.statements.list(tx, ctx, { ...input, limit: 200 }),
      );

      return rows.map(toStatementDto);
    },

    async get(ctx: TenantContext, input: { id: string }): Promise<AgencyStatementDto> {
      return toStatementDto(await load(ctx, input.id));
    },

    async document(ctx: TenantContext, input: { id: string }) {
      const s = (await load(ctx, input.id)).toSnapshot();
      const file = s.documentKey ? await deps.storage.get(s.documentKey) : null;

      if (!file) throw notFound("Statement document", input.id);

      return { fileName: `${s.number}.pdf`, title: `Account current ${s.number}`, body: file.body };
    },

    /** Whether the agency still has statements past due (the privilege stays suspended). */
    async hasPastDue(ctx: TenantContext, input: { agencyId: string }): Promise<boolean> {
      const rows = await deps.uow.run(ctx, (tx) =>
        deps.statements.list(tx, ctx, {
          agencyIds: [input.agencyId],
          statuses: ["past_due"],
          limit: 1,
        }),
      );

      return rows.length > 0;
    },

    /**
     * May this agency bill another `amount` now (PLAN §13)? Eligible, not suspended for aging,
     * and within its credit limit counting what's already outstanding.
     */
    async checkAgencyBill(
      ctx: TenantContext,
      input: { agencyId: string; amount: Money },
    ): Promise<{ available: boolean; reason: string | null; agencyName: string }> {
      const terms = await deps.agencies.terms(ctx, input);
      const no = (reason: string) => ({ available: false, reason, agencyName: terms.name });

      if (!terms.eligible) return no(`${terms.name} isn't approved for agency bill`);

      if (terms.suspension) {
        return no(`Agency bill is suspended for ${terms.name}: ${terms.suspension.reason}`);
      }

      if (!terms.mayAgencyBill) return no(`${terms.name} isn't active`);

      if (terms.creditLimit) {
        const limit = Money.of(terms.creditLimit.amount, terms.creditLimit.currency);

        const outstanding = await deps.uow.run(ctx, (tx) =>
          deps.statements.agencyBalance(tx, ctx, input.agencyId, limit.currency),
        );

        if (outstanding.plus(input.amount).amount.greaterThan(limit.amount)) {
          return no(
            `${formatMoney(input.amount)} would take ${terms.name} over its ${formatMoney(limit)} agency-bill credit limit (${formatMoney(outstanding)} outstanding). Bind on direct bill, or ask to raise the limit.`,
          );
        }
      }

      return { available: true, reason: null, agencyName: terms.name };
    },

    /** Outstanding agency-billed balance, for the credit limit check at bind. */
    async outstanding(ctx: TenantContext, input: { agencyId: string; currency: string }) {
      return deps.uow.run(ctx, (tx) =>
        deps.statements.agencyBalance(tx, ctx, input.agencyId, input.currency),
      );
    },
  };
}

export type AgencyStatements = ReturnType<typeof makeAgencyStatements>;
