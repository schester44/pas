import type { TenantContext, Transaction } from "@pas/kernel";
import { accountFor, CHART_TEMPLATE, payerTypeOf, receivableAccount } from "../domain/accounts";
import { credit, debit } from "../domain/journal";
import { openingLines, receivableDims } from "../domain/posting-rules";
import type { PasInvoiceBalance } from "../ports/pas-billing";
import { clockOf, type LedgerDeps, post, SYSTEM } from "./deps";

const opened = new Set<string>();

/** PAS's balance on the ledger's basis: an installment's fee isn't owed until it bills. */
export const writtenBalance = (invoice: PasInvoiceBalance) =>
  invoice.balance.minus(invoice.unbilledFee);

/**
 * Opens a tenant's ledger on first use: the chart of accounts, the settings, and an opening entry
 * for each invoice PAS already has, so the ledger starts out reconciled. Facts that PAS applied
 * before the opening are already in those balances and are skipped. A ledger opened before
 * receivables were booked for the full term at issue gets adjusting entries once. Idempotent.
 */
export function makeOpenLedger(deps: LedgerDeps) {
  return async function openLedger(ctx: TenantContext): Promise<void> {
    if (opened.has(ctx.tenantId)) return;

    const existing = await deps.uow.run(ctx, (tx) => deps.settings.find(tx, ctx));

    if (existing) {
      if (existing.receivableBasis !== "written") await alignToWrittenBasis(deps, ctx);

      opened.add(ctx.tenantId);

      return;
    }

    const invoices = await deps.pas.invoices(ctx);
    const clock = clockOf(deps, ctx);

    await deps.uow.run(ctx, async (tx) => {
      if (await deps.settings.find(tx, ctx)) return;

      const now = clock.now();
      const today = clock.today("UTC");

      await deps.journal.ensureChart(tx, ctx, CHART_TEMPLATE, now);

      await deps.settings.save(
        tx,
        ctx,
        {
          currency: invoices[0]?.currency ?? "USD",
          receivableBasis: "written",
          smallBalanceWriteOff: null,
          openedAt: now,
        },
        now,
      );

      for (const invoice of invoices) {
        const receivable = {
          invoiceId: invoice.invoiceId,
          number: invoice.number,
          kind: invoice.kind,
          policyId: invoice.policyId,
          policyNumber: invoice.policyNumber,
          payerType: payerTypeOf(invoice.payer),
          payerRef: invoice.payerRef,
          payerName: invoice.payerName,
          jurisdiction: null,
          currency: invoice.currency,
          total: invoice.total,
          issuedOn: invoice.issuedOn,
          dueOn: invoice.dueOn,
          statementId: null,
          statementNumber: null,
          billedOn: invoice.status === "scheduled" ? null : invoice.issuedOn,
        };

        await deps.receivables.save(tx, ctx, receivable, now);

        const balance = writtenBalance(invoice);

        if (balance.isZero()) continue;

        await post(deps, tx, ctx, {
          key: `opening:${invoice.invoiceId}`,
          kind: "opening_balance",
          source: { type: "invoice", id: invoice.invoiceId },
          effectiveOn: today,
          actor: SYSTEM,
          memo: `Opening balance of ${invoice.number}`,
          lines: openingLines(receivable, balance),
        });
      }

      await deps.audit.record(tx, ctx, {
        action: "ledger.opened",
        entityType: "ledger",
        entityId: ctx.tenantId,
        actor: SYSTEM,
        before: null,
        after: { invoices: invoices.length },
        idempotencyKey: null,
        occurredAt: now,
      });
    });

    opened.add(ctx.tenantId);
  };
}

/**
 * Moves receivables booked per installment onto the written basis with adjusting entries, never by
 * editing what was posted: an installment booked on its future issue date is reversed and
 * re-posted on the day it was recorded, and each installment's booked fee is brought to what's
 * owed: nothing until it bills, then the fee on the bill. Idempotent per invoice, so reconciliation runs it to repair any stragglers.
 */
export async function alignToWrittenBasis(deps: LedgerDeps, ctx: TenantContext) {
  const invoices = new Map((await deps.pas.invoices(ctx)).map((i) => [i.invoiceId, i]));
  const clock = clockOf(deps, ctx);

  await deps.uow.run(ctx, async (tx) => {
    const settings = await deps.settings.find(tx, ctx);

    if (!settings) return;

    const now = clock.now();
    const receivables = await deps.receivables.list(tx, ctx, {});

    for (const receivable of receivables) {
      await rebaseIssue(deps, tx, ctx, receivable.invoiceId);

      const pas = invoices.get(receivable.invoiceId);

      if (!pas) continue;

      const unbilled = pas.status === "scheduled" || pas.status === "void";

      await deps.receivables.save(
        tx,
        ctx,
        { ...receivable, billedOn: unbilled ? null : (receivable.billedOn ?? receivable.issuedOn) },
        now,
      );

      const booked = (
        await deps.journal.invoiceTotal(
          tx,
          ctx,
          accountFor("installment_fee_income"),
          receivable.invoiceId,
          receivable.currency,
        )
      ).negated();

      const owed = unbilled ? booked.minus(booked) : pas.installmentFee;
      const excess = booked.minus(owed);

      if (excess.isZero()) continue;

      await post(deps, tx, ctx, {
        key: `fee-align:${receivable.invoiceId}:${booked.toString()}:${owed.toString()}`,
        kind: "receivable_rebased",
        source: { type: "invoice", id: receivable.invoiceId },
        effectiveOn: clock.today("UTC"),
        actor: SYSTEM,
        memo: unbilled
          ? `Installment fee on ${receivable.number} deferred until it bills`
          : `Installment fee on ${receivable.number} aligned with the bill`,
        lines: [
          debit(accountFor("installment_fee_income"), excess, {
            policyId: receivable.policyId,
            invoiceId: receivable.invoiceId,
          }),
          credit(receivableAccount(receivable.payerType), excess, receivableDims(receivable)),
        ],
      });
    }

    if (settings.receivableBasis === "written") return;

    await deps.settings.save(tx, ctx, { ...settings, receivableBasis: "written" }, now);

    await deps.audit.record(tx, ctx, {
      action: "ledger.rebased",
      entityType: "ledger",
      entityId: ctx.tenantId,
      actor: SYSTEM,
      before: { receivableBasis: settings.receivableBasis },
      after: { receivableBasis: "written", receivables: receivables.length },
      idempotencyKey: null,
      occurredAt: now,
    });
  });
}

async function rebaseIssue(
  deps: LedgerDeps,
  tx: Transaction,
  ctx: TenantContext,
  invoiceId: string,
) {
  const original = await deps.journal.findByKey(tx, ctx, `invoice:${invoiceId}`);

  if (!original || (await deps.journal.isReversed(tx, ctx, original.id))) return;

  const o = original.toSnapshot();
  const recordedOn = o.recordedAt.toZonedDateTimeISO("UTC").toPlainDate();

  if (Temporal.PlainDate.compare(o.effectiveOn, recordedOn) <= 0) return;

  const clock = clockOf(deps, ctx);

  await deps.journal.post(
    tx,
    ctx,
    original.reverse(
      {
        key: `invoice:${invoiceId}:rebase-reversal`,
        effectiveOn: o.effectiveOn,
        actor: SYSTEM,
        memo: `${o.memo}: moved to the written basis`,
      },
      clock,
    ),
  );

  await post(deps, tx, ctx, {
    key: `invoice:${invoiceId}:written`,
    kind: o.kind,
    source: o.source,
    effectiveOn: recordedOn,
    actor: SYSTEM,
    memo: o.memo,
    lines: o.lines,
  });
}

export type OpenLedger = ReturnType<typeof makeOpenLedger>;
