import { moneyFromDb, plainDateToDb, type PrismaTx, prismaTx } from "@pas/db";
import type { LedgerEntry, LedgerLine, LedgerPayment, Prisma } from "@pas/db/client";
import { Money, type TenantContext, type UnitOfWork } from "@pas/kernel";
import { accountFor, accountNamed, RECEIVABLE_ACCOUNTS } from "../domain/accounts";
import type {
  AuditDto,
  EntryDto,
  EntryFilter,
  LedgerQueries,
  MoneyDto,
  OpenItemDto,
  PaymentDto,
  PaymentFilter,
} from "../ports/queries";
import { toReceivable } from "./prisma-ledger-repositories";

const iso = (d: Date) => d.toISOString();
const day = (d: Date) => d.toISOString().slice(0, 10);

const json = (amount: Prisma.Decimal | string, currency: string): MoneyDto =>
  moneyFromDb(amount, currency).toJSON();

/** Ledger read models; each runs in a tenant-scoped transaction so RLS applies. */
export class PrismaLedgerQueries implements LedgerQueries {
  constructor(private readonly uow: UnitOfWork) {}

  private read<T>(ctx: TenantContext, work: (db: PrismaTx) => Promise<T>): Promise<T> {
    return this.uow.run(ctx, (tx) => work(prismaTx(tx)));
  }

  private async toEntries(
    db: PrismaTx,
    ctx: TenantContext,
    rows: readonly LedgerEntry[],
  ): Promise<EntryDto[]> {
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);

    const [lines, reversals] = await Promise.all([
      db.ledgerLine.findMany({ where: { tenantId: ctx.tenantId, entryId: { in: ids } } }),
      db.ledgerEntry.findMany({
        where: { tenantId: ctx.tenantId, reversesId: { in: ids } },
        select: { id: true, reversesId: true },
      }),
    ]);

    const invoiceIds = [
      ...new Set(lines.map((l) => l.invoiceId).filter((id): id is string => Boolean(id))),
    ];

    const numbers = new Map(
      (
        await db.ledgerReceivable.findMany({
          where: { tenantId: ctx.tenantId, invoiceId: { in: invoiceIds } },
          select: { invoiceId: true, number: true },
        })
      ).map((r) => [r.invoiceId, r.number]),
    );

    return rows.map((row) => {
      const own = lines
        .filter((l) => l.entryId === row.id)
        .toSorted((a, b) => a.position - b.position);

      const currency = own[0]?.currency ?? "USD";

      const debits = own
        .filter((l) => l.amount.greaterThan(0))
        .reduce((sum, l) => sum.plus(moneyFromDb(l.amount, l.currency)), Money.zero(currency));

      return {
        id: row.id,
        number: row.number,
        kind: row.kind,
        memo: row.memo,
        effectiveOn: day(row.effectiveOn),
        recordedAt: iso(row.recordedAt),
        actor: { type: row.actorType, id: row.actorId, name: row.actorName },
        source: { type: row.sourceType, id: row.sourceId },
        idempotencyKey: row.idempotencyKey,
        billingEventId: row.billingEventId,
        reversesId: row.reversesId,
        reversedById: reversals.find((r) => r.reversesId === row.id)?.id ?? null,
        total: debits.toJSON(),
        lines: own.map((l) => lineDto(l, numbers)),
      };
    });
  }

  entries(ctx: TenantContext, filter: EntryFilter) {
    return this.read(ctx, async (db) => {
      const lineFilter: Prisma.LedgerLineWhereInput = {
        ...(filter.account && { accountCode: filter.account }),
        ...(filter.policyId && { policyId: filter.policyId }),
        ...(filter.invoiceId && { invoiceId: filter.invoiceId }),
        ...(filter.paymentId && { paymentId: filter.paymentId }),
      };

      const entryIds = Object.keys(lineFilter).length
        ? [
            ...new Set(
              (
                await db.ledgerLine.findMany({
                  where: { tenantId: ctx.tenantId, ...lineFilter },
                  select: { entryId: true },
                })
              ).map((l) => l.entryId),
            ),
          ]
        : null;

      const rows = await db.ledgerEntry.findMany({
        where: {
          tenantId: ctx.tenantId,
          ...(entryIds && { id: { in: entryIds } }),
          ...((filter.from || filter.to) && {
            effectiveOn: {
              ...(filter.from && { gte: plainDateToDb(Temporal.PlainDate.from(filter.from)) }),
              ...(filter.to && { lte: plainDateToDb(Temporal.PlainDate.from(filter.to)) }),
            },
          }),
        },
        orderBy: { number: "desc" },
        take: filter.limit ?? 100,
      });

      return this.toEntries(db, ctx, rows);
    });
  }

  entry(ctx: TenantContext, id: string) {
    return this.read(ctx, async (db) => {
      const row = await db.ledgerEntry.findFirst({ where: { tenantId: ctx.tenantId, id } });

      return row ? ((await this.toEntries(db, ctx, [row]))[0] ?? null) : null;
    });
  }

  accountBalances(ctx: TenantContext) {
    return this.read(ctx, async (db) => {
      const [accounts, balances] = await Promise.all([
        db.ledgerAccount.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { code: "asc" } }),
        db.ledgerBalance.findMany({ where: { tenantId: ctx.tenantId } }),
      ]);

      return accounts.flatMap((a) => {
        const own = balances.filter((b) => b.accountCode === a.code);
        const rows = own.length ? own : [{ currency: "USD", balance: "0", version: 0 }];

        return rows.map((b) => ({
          code: a.code,
          name: a.name,
          type: a.type,
          role: a.role,
          currency: b.currency,
          balance: moneyFromDb(b.balance, b.currency).toString(),
          version: b.version,
        }));
      });
    });
  }

  balancesAsOf(ctx: TenantContext, asOf: string) {
    return this.read(ctx, async (db) => {
      const rows = await db.ledgerLine.groupBy({
        by: ["accountCode", "currency"],
        where: {
          tenantId: ctx.tenantId,
          effectiveOn: { lte: plainDateToDb(Temporal.PlainDate.from(asOf)) },
        },
        _sum: { amount: true },
      });

      return rows.map((r) => ({
        code: r.accountCode,
        currency: r.currency,
        balance: moneyFromDb(r._sum.amount ?? "0", r.currency).toString(),
      }));
    });
  }

  linesFor(ctx: TenantContext, input: { account: string; from: string; to: string }) {
    return this.read(ctx, async (db) => {
      const opening = await db.ledgerLine.groupBy({
        by: ["currency"],
        where: {
          tenantId: ctx.tenantId,
          accountCode: input.account,
          effectiveOn: { lt: plainDateToDb(Temporal.PlainDate.from(input.from)) },
        },
        _sum: { amount: true },
      });

      const ids = [
        ...new Set(
          (
            await db.ledgerLine.findMany({
              where: {
                tenantId: ctx.tenantId,
                accountCode: input.account,
                effectiveOn: {
                  gte: plainDateToDb(Temporal.PlainDate.from(input.from)),
                  lte: plainDateToDb(Temporal.PlainDate.from(input.to)),
                },
              },
              select: { entryId: true },
            })
          ).map((l) => l.entryId),
        ),
      ];

      const rows = await db.ledgerEntry.findMany({
        where: { tenantId: ctx.tenantId, id: { in: ids } },
        orderBy: [{ effectiveOn: "asc" }, { number: "asc" }],
      });

      return {
        opening: opening.map((o) => ({
          currency: o.currency,
          balance: moneyFromDb(o._sum.amount ?? "0", o.currency).toString(),
        })),
        entries: await this.toEntries(db, ctx, rows),
      };
    });
  }

  private async toPayments(
    db: PrismaTx,
    ctx: TenantContext,
    rows: readonly LedgerPayment[],
  ): Promise<PaymentDto[]> {
    const ids = rows.map((r) => r.id);

    const [applications, batches] = await Promise.all([
      db.ledgerApplication.findMany({
        where: { tenantId: ctx.tenantId, paymentId: { in: ids } },
        orderBy: { appliedAt: "asc" },
      }),
      db.ledgerDepositBatch.findMany({
        where: {
          tenantId: ctx.tenantId,
          id: { in: rows.map((r) => r.batchId).filter((id): id is string => Boolean(id)) },
        },
        select: { id: true, number: true },
      }),
    ]);

    const receivables = await db.ledgerReceivable.findMany({
      where: { tenantId: ctx.tenantId, invoiceId: { in: applications.map((a) => a.invoiceId) } },
      select: { invoiceId: true, number: true, policyNumber: true },
    });

    return rows.map((p) => {
      const unapplied = moneyFromDb(p.amount, p.currency)
        .minus(moneyFromDb(p.applied, p.currency))
        .minus(moneyFromDb(p.refunded, p.currency));

      return {
        id: p.id,
        number: p.number,
        rail: p.rail,
        payerType: p.payerType,
        payerRef: p.payerRef,
        payerName: p.payerName,
        amount: json(p.amount, p.currency),
        applied: json(p.applied, p.currency),
        refunded: json(p.refunded, p.currency),
        unapplied: p.status === "reversed" ? Money.zero(p.currency).toJSON() : unapplied.toJSON(),
        receivedOn: day(p.receivedOn),
        reference: p.reference,
        provider: p.provider,
        batchId: p.batchId,
        batchNumber: batches.find((b) => b.id === p.batchId)?.number ?? null,
        status: p.status,
        reversalReason: p.reversalReason,
        memo: p.memo,
        createdAt: iso(p.createdAt),
        applications: applications
          .filter((a) => a.paymentId === p.id)
          .map((a) => {
            const r = receivables.find((x) => x.invoiceId === a.invoiceId);

            return {
              id: a.id,
              invoiceId: a.invoiceId,
              invoiceNumber: r?.number ?? null,
              policyId: a.policyId,
              policyNumber: r?.policyNumber ?? null,
              statementId: a.statementId,
              amount: json(a.amount, a.currency),
              status: a.status,
              appliedAt: iso(a.appliedAt),
              reversedAt: a.reversedAt ? iso(a.reversedAt) : null,
            };
          }),
      };
    });
  }

  payments(ctx: TenantContext, filter: PaymentFilter) {
    return this.read(ctx, async (db) => {
      const byPolicy = filter.policyId
        ? (
            await db.ledgerApplication.findMany({
              where: { tenantId: ctx.tenantId, policyId: filter.policyId },
              select: { paymentId: true },
            })
          ).map((a) => a.paymentId)
        : null;

      const rows = await db.ledgerPayment.findMany({
        where: {
          tenantId: ctx.tenantId,
          ...(filter.status && { status: { in: [...filter.status] } }),
          ...(filter.batchId && { batchId: filter.batchId }),
          ...(filter.payerType && { payerType: filter.payerType }),
          ...(filter.payerRef && { payerRef: filter.payerRef }),
          ...(byPolicy && { id: { in: byPolicy } }),
          ...(filter.unappliedOnly && { status: { in: ["unapplied", "partially_applied"] } }),
        },
        orderBy: { createdAt: "desc" },
        take: filter.limit ?? 100,
      });

      const payments = await this.toPayments(db, ctx, rows);

      return filter.unappliedOnly
        ? payments.filter((p) => Number(p.unapplied.amount) > 0)
        : payments;
    });
  }

  payment(ctx: TenantContext, id: string) {
    return this.read(ctx, async (db) => {
      const row = await db.ledgerPayment.findFirst({ where: { tenantId: ctx.tenantId, id } });

      return row ? ((await this.toPayments(db, ctx, [row]))[0] ?? null) : null;
    });
  }

  batches(ctx: TenantContext) {
    return this.read(ctx, async (db) => {
      const [batches, totals] = await Promise.all([
        db.ledgerDepositBatch.findMany({
          where: { tenantId: ctx.tenantId },
          orderBy: { createdAt: "desc" },
          take: 100,
        }),
        db.ledgerPayment.groupBy({
          by: ["batchId", "currency"],
          where: { tenantId: ctx.tenantId, batchId: { not: null }, status: { not: "reversed" } },
          _sum: { amount: true },
          _count: { _all: true },
        }),
      ]);

      return batches.map((b) => {
        const t = totals.find((x) => x.batchId === b.id);

        return {
          id: b.id,
          number: b.number,
          rail: b.rail,
          status: b.status,
          depositedOn: b.depositedOn ? day(b.depositedOn) : null,
          payments: t?._count._all ?? 0,
          total: t ? json(t._sum.amount ?? "0", t.currency) : null,
          createdAt: iso(b.createdAt),
        };
      });
    });
  }

  openItems(
    ctx: TenantContext,
    filter: { payerType?: string; payerRef?: string | null; policyId?: string; search?: string },
  ) {
    return this.read(ctx, async (db) => {
      const search = filter.search?.trim();

      const rows = await db.ledgerReceivable.findMany({
        where: {
          tenantId: ctx.tenantId,
          ...(filter.payerType && { payerType: filter.payerType }),
          ...(filter.payerRef !== undefined && { payerRef: filter.payerRef }),
          ...(filter.policyId && { policyId: filter.policyId }),
          ...(search && {
            OR: [
              { number: { contains: search, mode: "insensitive" } },
              { policyNumber: { contains: search, mode: "insensitive" } },
              { payerName: { contains: search, mode: "insensitive" } },
              { statementNumber: { contains: search, mode: "insensitive" } },
            ],
          }),
        },
        orderBy: [{ dueOn: "asc" }, { number: "asc" }],
        take: 500,
      });

      const balances = await arBalances(
        db,
        ctx,
        rows.map((r) => r.invoiceId),
      );

      return rows.flatMap((row): OpenItemDto[] => {
        const r = toReceivable(row);
        const balance = balances.get(r.invoiceId) ?? Money.zero(r.currency);

        if (balance.isZero()) return [];

        return [
          {
            invoiceId: r.invoiceId,
            number: r.number,
            kind: r.kind,
            policyId: r.policyId,
            policyNumber: r.policyNumber,
            payerType: r.payerType,
            payerRef: r.payerRef,
            payerName: r.payerName,
            statementId: r.statementId,
            statementNumber: r.statementNumber,
            issuedOn: r.issuedOn.toString(),
            dueOn: r.dueOn.toString(),
            total: r.total.toJSON(),
            balance: balance.toJSON(),
          },
        ];
      });
    });
  }

  async payers(ctx: TenantContext, input: { search?: string }) {
    const items = await this.openItems(ctx, input.search ? { search: input.search } : {});

    const unapplied = await this.payments(ctx, { unappliedOnly: true, limit: 1000 });

    const groups = new Map<
      string,
      { payerType: string; payerRef: string | null; payerName: string; items: OpenItemDto[] }
    >();

    for (const item of items) {
      const key = `${item.payerType}|${item.payerType === "insured" ? item.policyNumber : (item.payerRef ?? "")}`;

      const group = groups.get(key) ?? {
        payerType: item.payerType,
        payerRef: item.payerType === "insured" ? null : item.payerRef,
        payerName:
          item.payerName ??
          (item.payerType === "insured"
            ? `Insured on ${item.policyNumber}`
            : (item.payerRef ?? "Unknown payer")),
        items: [],
      };

      group.items.push(item);
      groups.set(key, group);
    }

    return [...groups.values()].map((g) => {
      const currency = g.items[0]!.balance.currency;
      const zero = Money.zero(currency);

      const cash = unapplied
        .filter(
          (p) => p.payerType === g.payerType && (g.payerRef === null || p.payerRef === g.payerRef),
        )
        .reduce((sum, p) => sum.plus(Money.of(p.unapplied.amount, currency)), zero);

      return {
        payerType: g.payerType,
        payerRef: g.payerRef,
        payerName: g.payerName,
        openItems: g.items.length,
        balance: g.items
          .reduce((sum, i) => sum.plus(Money.of(i.balance.amount, currency)), zero)
          .toJSON(),
        unapplied: (g.payerType === "insured" ? zero : cash).toJSON(),
      };
    });
  }

  lockboxImports(ctx: TenantContext) {
    return this.read(ctx, async (db) =>
      (
        await db.ledgerLockboxImport.findMany({
          where: { tenantId: ctx.tenantId },
          orderBy: { importedAt: "desc" },
          take: 50,
        })
      ).map((i) => ({
        id: i.id,
        fileName: i.fileName,
        batchId: i.batchId,
        rows: i.rows,
        matched: i.matched,
        exceptions: i.exceptions,
        importedAt: iso(i.importedAt),
      })),
    );
  }

  lockboxItems(ctx: TenantContext, filter: { importId?: string; status?: string }) {
    return this.read(ctx, async (db) => {
      const items = await db.ledgerLockboxItem.findMany({
        where: {
          tenantId: ctx.tenantId,
          ...(filter.importId && { importId: filter.importId }),
          ...(filter.status && { status: filter.status }),
        },
        orderBy: [{ importId: "desc" }, { row: "asc" }],
        take: 500,
      });

      const [imports, payments] = await Promise.all([
        db.ledgerLockboxImport.findMany({
          where: { tenantId: ctx.tenantId, id: { in: [...new Set(items.map((i) => i.importId))] } },
          select: { id: true, fileName: true },
        }),
        db.ledgerPayment.findMany({
          where: {
            tenantId: ctx.tenantId,
            id: { in: items.map((i) => i.paymentId).filter((id): id is string => Boolean(id)) },
          },
          select: { id: true, number: true },
        }),
      ]);

      return items.map((i) => ({
        id: i.id,
        importId: i.importId,
        fileName: imports.find((x) => x.id === i.importId)?.fileName ?? "",
        row: i.row,
        raw: i.raw as Record<string, string>,
        amount: json(i.amount, i.currency),
        reference: i.reference,
        matchedBy: i.matchedBy,
        status: i.status,
        reason: i.reason,
        paymentId: i.paymentId,
        paymentNumber: payments.find((p) => p.id === i.paymentId)?.number ?? null,
        invoiceId: i.invoiceId,
      }));
    });
  }

  refunds(ctx: TenantContext) {
    return this.read(ctx, async (db) => {
      const rows = await db.ledgerRefund.findMany({
        where: { tenantId: ctx.tenantId },
        orderBy: { createdAt: "desc" },
        take: 100,
      });

      const numbers = await receivableNumbers(
        db,
        ctx,
        rows.map((r) => r.invoiceId),
      );

      return rows.map((r) => ({
        id: r.id,
        number: r.number,
        source: r.source,
        paymentId: r.paymentId,
        invoiceId: r.invoiceId,
        invoiceNumber: r.invoiceId ? (numbers.get(r.invoiceId)?.number ?? null) : null,
        payerName: r.payerName,
        amount: json(r.amount, r.currency),
        method: r.method,
        status: r.status,
        checkNumber: r.checkNumber,
        createdAt: iso(r.createdAt),
      }));
    });
  }

  writeOffs(ctx: TenantContext, filter: { status?: string }) {
    return this.read(ctx, async (db) => {
      const rows = await db.ledgerWriteOff.findMany({
        where: { tenantId: ctx.tenantId, ...(filter.status && { status: filter.status }) },
        orderBy: { createdAt: "desc" },
        take: 100,
      });

      const numbers = await receivableNumbers(
        db,
        ctx,
        rows.map((r) => r.invoiceId),
      );

      return rows.map((w) => ({
        id: w.id,
        invoiceId: w.invoiceId,
        invoiceNumber: numbers.get(w.invoiceId)?.number ?? null,
        policyNumber: numbers.get(w.invoiceId)?.policyNumber ?? null,
        amount: json(w.amount, w.currency),
        reason: w.reason,
        status: w.status,
        requestedBy: w.requestedBy,
        requestedById: w.requestedById,
        decidedBy: w.decidedBy,
        createdAt: iso(w.createdAt),
      }));
    });
  }

  reconciliations(ctx: TenantContext, limit: number) {
    return this.read(ctx, async (db) =>
      (
        await db.ledgerReconciliation.findMany({
          where: { tenantId: ctx.tenantId },
          orderBy: { ranAt: "desc" },
          take: limit,
        })
      ).map((r) => ({
        id: r.id,
        asOf: day(r.asOf),
        ranAt: iso(r.ranAt),
        status: r.status,
        ledgerTotal: json(r.ledgerTotal, r.currency),
        pasTotal: json(r.pasTotal, r.currency),
        invoices: r.invoices,
        differences: r.differences as never,
        cacheDrift: (
          r.cacheDrift as { account: string; currency: string; cached: unknown; derived: unknown }[]
        ).map((d) => ({
          account: d.account,
          currency: d.currency,
          cached: String(d.cached),
          derived: String(d.derived),
        })),
      })),
    );
  }

  taxesByJurisdiction(ctx: TenantContext, asOf: string) {
    return this.read(ctx, async (db) => {
      const rows = await db.ledgerLine.groupBy({
        by: ["jurisdiction", "currency"],
        where: {
          tenantId: ctx.tenantId,
          accountCode: accountFor("taxes_fees_payable"),
          effectiveOn: { lte: plainDateToDb(Temporal.PlainDate.from(asOf)) },
        },
        _sum: { amount: true },
      });

      return rows
        .map((r) => ({
          jurisdiction: r.jurisdiction ?? "Unassigned",
          currency: r.currency,
          balance: moneyFromDb(r._sum.amount ?? "0", r.currency)
            .negated()
            .toString(),
        }))
        .filter((r) => Number(r.balance) !== 0)
        .toSorted((a, b) => a.jurisdiction.localeCompare(b.jurisdiction));
    });
  }

  premiumPayable(ctx: TenantContext, asOf: string) {
    return this.read(ctx, async (db) => {
      const lines = await db.ledgerLine.findMany({
        where: {
          tenantId: ctx.tenantId,
          accountCode: accountFor("premium_payable"),
          effectiveOn: { lte: plainDateToDb(Temporal.PlainDate.from(asOf)) },
        },
        select: { policyId: true, currency: true, amount: true, entryId: true },
      });

      const commissionEntries = new Set(
        (
          await db.ledgerEntry.findMany({
            where: {
              tenantId: ctx.tenantId,
              kind: "commission",
              id: { in: lines.map((l) => l.entryId) },
            },
            select: { id: true },
          })
        ).map((e) => e.id),
      );

      const numbers = new Map(
        (
          await db.ledgerReceivable.findMany({
            where: {
              tenantId: ctx.tenantId,
              policyId: {
                in: lines.map((l) => l.policyId).filter((id): id is string => Boolean(id)),
              },
            },
            select: { policyId: true, policyNumber: true },
          })
        ).map((r) => [r.policyId, r.policyNumber]),
      );

      const byPolicy = new Map<string, { currency: string; gross: Money; commission: Money }>();

      for (const line of lines) {
        const id = line.policyId ?? "unassigned";

        const row = byPolicy.get(id) ?? {
          currency: line.currency,
          gross: Money.zero(line.currency),
          commission: Money.zero(line.currency),
        };

        const amount = moneyFromDb(line.amount, line.currency).negated();

        if (commissionEntries.has(line.entryId)) row.commission = row.commission.minus(amount);
        else row.gross = row.gross.plus(amount);

        byPolicy.set(id, row);
      }

      return [...byPolicy]
        .map(([policyId, r]) => ({
          policyId,
          policyNumber: numbers.get(policyId) ?? null,
          currency: r.currency,
          gross: r.gross.toString(),
          commission: r.commission.toString(),
          net: r.gross.minus(r.commission).toString(),
        }))
        .filter((r) => Number(r.gross) !== 0 || Number(r.commission) !== 0)
        .toSorted((a, b) => (a.policyNumber ?? "").localeCompare(b.policyNumber ?? ""));
    });
  }

  audit(ctx: TenantContext, filter: { entityType?: string; entityId?: string; limit: number }) {
    return this.read(ctx, async (db): Promise<AuditDto[]> =>
      (
        await db.ledgerAuditEntry.findMany({
          where: {
            tenantId: ctx.tenantId,
            ...(filter.entityType && { entityType: filter.entityType }),
            ...(filter.entityId && { entityId: filter.entityId }),
          },
          orderBy: { occurredAt: "desc" },
          take: filter.limit,
        })
      ).map((a) => ({
        id: a.id,
        occurredAt: iso(a.occurredAt),
        actor: a.actorName,
        action: a.action,
        entityType: a.entityType,
        entityId: a.entityId,
        before: a.before,
        after: a.after,
      })),
    );
  }
}

function lineDto(l: LedgerLine, numbers: ReadonlyMap<string, string>) {
  const amount = moneyFromDb(l.amount, l.currency);

  return {
    account: l.accountCode,
    accountName: accountNamed(l.accountCode)?.name ?? l.accountCode,
    debit: amount.isNegative() ? null : amount.toJSON(),
    credit: amount.isNegative() ? amount.negated().toJSON() : null,
    payerType: l.payerType,
    payerRef: l.payerRef,
    policyId: l.policyId,
    invoiceId: l.invoiceId,
    invoiceNumber: l.invoiceId ? (numbers.get(l.invoiceId) ?? null) : null,
    paymentId: l.paymentId,
    agencyId: l.agencyId,
    jurisdiction: l.jurisdiction,
  };
}

async function arBalances(db: PrismaTx, ctx: TenantContext, invoiceIds: readonly string[]) {
  const rows = await db.ledgerLine.groupBy({
    by: ["invoiceId", "currency"],
    where: {
      tenantId: ctx.tenantId,
      accountCode: { in: [...RECEIVABLE_ACCOUNTS] },
      invoiceId: { in: [...invoiceIds] },
    },
    _sum: { amount: true },
  });

  return new Map(
    rows.map((r) => [r.invoiceId!, moneyFromDb(r._sum.amount ?? "0", r.currency)] as const),
  );
}

async function receivableNumbers(
  db: PrismaTx,
  ctx: TenantContext,
  ids: readonly (string | null)[],
) {
  const rows = await db.ledgerReceivable.findMany({
    where: {
      tenantId: ctx.tenantId,
      invoiceId: { in: ids.filter((id): id is string => Boolean(id)) },
    },
    select: { invoiceId: true, number: true, policyNumber: true },
  });

  return new Map(rows.map((r) => [r.invoiceId, r]));
}
