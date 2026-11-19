import { Money, type TenantContext, toCsv } from "@pas/kernel";
import { CHART_TEMPLATE, payerTypeOf } from "../domain/accounts";
import { AGING_BUCKETS, ageReceivables, naturalBalance, trialBalance } from "../domain/reports";
import type { EntryFilter, MoneyDto, PaymentFilter } from "../ports/queries";
import { audit, clockOf, type CommandMeta, type LedgerDeps, runCommand, todayOf } from "./deps";
import type { OpenLedger } from "./open-ledger";

const m = (money: Money): MoneyDto => money.toJSON();

export type LedgerReport =
  | "trial_balance"
  | "ar_aging"
  | "unapplied_cash"
  | "deposits"
  | "carrier_payable"
  | "taxes_payable";

/** The ledger's read side: journal, balances, cash application and finance reports. */
export function makeReadLedger(deps: LedgerDeps & { open: OpenLedger }) {
  const q = deps.queries;

  const currencyOf = async (ctx: TenantContext) =>
    (await deps.uow.run(ctx, (tx) => deps.settings.find(tx, ctx)))?.currency ?? "USD";

  const reads = {
    async settings(ctx: TenantContext) {
      await deps.open(ctx);

      const s = await deps.uow.run(ctx, (tx) => deps.settings.find(tx, ctx));

      return {
        currency: s?.currency ?? "USD",
        smallBalanceWriteOff: s?.smallBalanceWriteOff ? m(s.smallBalanceWriteOff) : null,
        openedAt: s?.openedAt.toString() ?? null,
        today: todayOf(deps, ctx).toString(),
      };
    },

    async entries(ctx: TenantContext, filter: EntryFilter) {
      await deps.open(ctx);

      return q.entries(ctx, filter);
    },

    async entry(ctx: TenantContext, id: string) {
      await deps.open(ctx);

      return q.entry(ctx, id);
    },

    async accounts(ctx: TenantContext) {
      await deps.open(ctx);

      const balances = await q.accountBalances(ctx);

      return balances.map((b) => ({
        ...b,
        natural: naturalBalance(
          b.type as Parameters<typeof naturalBalance>[0],
          Money.of(b.balance, b.currency),
        ).toString(),
      }));
    },

    async trialBalance(ctx: TenantContext, input: { asOf?: string }) {
      await deps.open(ctx);

      const asOf = input.asOf ?? todayOf(deps, ctx).toString();
      const currency = await currencyOf(ctx);
      const rows = await q.balancesAsOf(ctx, asOf);

      const tb = trialBalance(
        CHART_TEMPLATE.map((a) => ({
          code: a.code,
          name: a.name,
          type: a.type,
          balance: Money.of(
            rows.find((r) => r.code === a.code && r.currency === currency)?.balance ?? "0",
            currency,
          ),
        })),
        currency,
      );

      return {
        asOf,
        currency,
        balanced: tb.balanced,
        debits: m(tb.debits),
        credits: m(tb.credits),
        rows: tb.rows.map((r) => ({ ...r, debit: m(r.debit), credit: m(r.credit) })),
      };
    },

    async activity(ctx: TenantContext, input: { account: string; from: string; to: string }) {
      await deps.open(ctx);

      return q.linesFor(ctx, input);
    },

    async payments(ctx: TenantContext, filter: PaymentFilter) {
      await deps.open(ctx);

      return q.payments(ctx, filter);
    },

    async payment(ctx: TenantContext, id: string) {
      await deps.open(ctx);

      return q.payment(ctx, id);
    },

    async batches(ctx: TenantContext) {
      await deps.open(ctx);

      return q.batches(ctx);
    },

    async payers(ctx: TenantContext, input: { search?: string }) {
      await deps.open(ctx);

      return q.payers(ctx, input);
    },

    async openItems(
      ctx: TenantContext,
      filter: { payerType?: string; payerRef?: string | null; policyId?: string; search?: string },
    ) {
      await deps.open(ctx);

      return q.openItems(ctx, filter);
    },

    async lockbox(ctx: TenantContext) {
      await deps.open(ctx);

      const [imports, exceptions] = await Promise.all([
        q.lockboxImports(ctx),
        q.lockboxItems(ctx, { status: "exception" }),
      ]);

      return { imports, exceptions };
    },

    async lockboxItems(ctx: TenantContext, importId: string) {
      await deps.open(ctx);

      return q.lockboxItems(ctx, { importId });
    },

    async refunds(ctx: TenantContext) {
      await deps.open(ctx);

      return q.refunds(ctx);
    },

    async writeOffs(ctx: TenantContext, filter: { status?: string }) {
      await deps.open(ctx);

      return q.writeOffs(ctx, filter);
    },

    async reconciliations(ctx: TenantContext) {
      await deps.open(ctx);

      return q.reconciliations(ctx, 30);
    },

    async audit(ctx: TenantContext, filter: { entityType?: string; entityId?: string }) {
      await deps.open(ctx);

      return q.audit(ctx, { ...filter, limit: 100 });
    },

    async aging(ctx: TenantContext, input: { asOf?: string }) {
      await deps.open(ctx);

      const asOf = input.asOf ?? todayOf(deps, ctx).toString();
      const currency = await currencyOf(ctx);
      const items = await q.openItems(ctx, {});

      const rows = ageReceivables(
        items.map((i) => ({
          payerType: payerTypeOf(i.payerType),
          dueOn: Temporal.PlainDate.from(i.dueOn),
          balance: Money.of(i.balance.amount, i.balance.currency),
        })),
        Temporal.PlainDate.from(asOf),
        currency,
      );

      const zero = Money.zero(currency);

      const sum = (pick: (r: (typeof rows)[number]) => Money) =>
        rows.reduce((t, r) => t.plus(pick(r)), zero);

      return {
        asOf,
        currency,
        rows: rows.map((r) => ({
          payerType: r.payerType,
          buckets: Object.fromEntries(AGING_BUCKETS.map((b) => [b, m(r.buckets[b])])) as Record<
            (typeof AGING_BUCKETS)[number],
            MoneyDto
          >,
          credits: m(r.credits),
          total: m(r.total),
        })),
        totals: {
          buckets: Object.fromEntries(
            AGING_BUCKETS.map((b) => [b, m(sum((r) => r.buckets[b]))]),
          ) as Record<(typeof AGING_BUCKETS)[number], MoneyDto>,
          credits: m(sum((r) => r.credits)),
          total: m(sum((r) => r.total)),
        },
      };
    },

    async carrierPayable(ctx: TenantContext, input: { asOf?: string }) {
      await deps.open(ctx);

      return q.premiumPayable(ctx, input.asOf ?? todayOf(deps, ctx).toString());
    },

    async taxesPayable(ctx: TenantContext, input: { asOf?: string }) {
      await deps.open(ctx);

      return q.taxesByJurisdiction(ctx, input.asOf ?? todayOf(deps, ctx).toString());
    },

    async csv(ctx: TenantContext, input: { report: LedgerReport; asOf?: string }) {
      const asOf = input.asOf ?? todayOf(deps, ctx).toString();
      const rows = await reportRows(ctx, input.report, asOf);

      return { fileName: `${input.report.replaceAll("_", "-")}-${asOf}.csv`, content: toCsv(rows) };
    },
  };

  async function reportRows(
    ctx: TenantContext,
    report: LedgerReport,
    asOf: string,
  ): Promise<string[][]> {
    switch (report) {
      case "trial_balance": {
        const tb = await reads.trialBalance(ctx, { asOf });

        return [
          ["Account", "Name", "Debit", "Credit"],
          ...tb.rows.map((r) => [r.code, r.name, r.debit.amount, r.credit.amount]),
          ["", "Total", tb.debits.amount, tb.credits.amount],
        ];
      }
      case "ar_aging": {
        const aging = await reads.aging(ctx, { asOf });

        return [
          ["Payer type", ...AGING_BUCKETS, "credits", "total"],
          ...aging.rows.map((r) => [
            r.payerType,
            ...AGING_BUCKETS.map((b) => r.buckets[b].amount),
            r.credits.amount,
            r.total.amount,
          ]),
        ];
      }
      case "unapplied_cash": {
        const payments = await reads.payments(ctx, { unappliedOnly: true, limit: 1000 });

        return [
          ["Payment", "Received", "Rail", "Payer", "Reference", "Amount", "Unapplied"],
          ...payments.map((p) => [
            p.number,
            p.receivedOn,
            p.rail,
            p.payerName ?? "",
            p.reference ?? "",
            p.amount.amount,
            p.unapplied.amount,
          ]),
        ];
      }
      case "deposits": {
        const batches = await reads.batches(ctx);

        return [
          ["Batch", "Rail", "Status", "Deposited", "Payments", "Total"],
          ...batches.map((b) => [
            b.number,
            b.rail,
            b.status,
            b.depositedOn ?? "",
            String(b.payments),
            b.total?.amount ?? "0",
          ]),
        ];
      }
      case "carrier_payable": {
        const rows = await reads.carrierPayable(ctx, { asOf });

        return [
          ["Policy", "Gross premium", "Commission", "Net payable"],
          ...rows.map((r) => [r.policyNumber ?? r.policyId, r.gross, r.commission, r.net]),
        ];
      }
      case "taxes_payable": {
        const rows = await reads.taxesPayable(ctx, { asOf });

        return [
          ["Jurisdiction", "Currency", "Payable"],
          ...rows.map((r) => [r.jurisdiction, r.currency, r.balance]),
        ];
      }
    }
  }

  return reads;
}

export function makeUpdateLedgerSettings(deps: LedgerDeps & { open: OpenLedger }) {
  return async function updateLedgerSettings(
    ctx: TenantContext,
    input: { smallBalanceWriteOff: Money | null } & CommandMeta,
  ): Promise<{ updated: true }> {
    await deps.open(ctx);

    return runCommand(
      deps,
      ctx,
      {
        action: "settings.update",
        request: { smallBalanceWriteOff: input.smallBalanceWriteOff?.toJSON() ?? null },
        meta: input,
      },
      async (tx) => {
        const current = await deps.settings.find(tx, ctx);

        if (!current) throw new Error("The ledger isn't open");

        await deps.settings.save(
          tx,
          ctx,
          { ...current, smallBalanceWriteOff: input.smallBalanceWriteOff },
          clockOf(deps, ctx).now(),
        );

        await audit(deps, tx, ctx, input, {
          action: "settings.updated",
          entityType: "ledger_settings",
          entityId: ctx.tenantId,
          before: { smallBalanceWriteOff: current.smallBalanceWriteOff?.toJSON() ?? null },
          after: { smallBalanceWriteOff: input.smallBalanceWriteOff?.toJSON() ?? null },
        });

        return { result: { updated: true as const } };
      },
    );
  };
}

export type ReadLedger = ReturnType<typeof makeReadLedger>;
