import { Money, type TenantContext } from "@pas/kernel";
import { RAILS, REVERSAL_REASONS } from "@pas/ledger";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { bookScopeOf } from "./book-scope";
import type { Context } from "./context";
import { requirePermission, router } from "./init";

const uc = (ctx: Context) => ctx.container.useCases.ledger;

type Session = NonNullable<Context["session"]>;

/** Finance staff only: tenant-wide billing permission and the whole book. */
const staff = (actions: ("read" | "write")[]) =>
  requirePermission({ billing: actions }).use(async ({ ctx, next }) => {
    if ((await bookScopeOf(ctx, ctx.tenant)).kind !== "tenant")
      throw new TRPCError({ code: "FORBIDDEN" });

    return next();
  });

const read = staff(["read"]);

/** Ledger commands only exist where the native billing system is the tenant's billing system. */
const write = staff(["read", "write"]).use(async ({ ctx, next }) => {
  if (!(await uc(ctx).isNative(ctx.tenant))) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "An external billing system is connected; record payments there",
    });
  }

  return next();
});

const money = z.object({
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Enter an amount like 125.00"),
  currency: z.string().length(3),
});

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const idempotencyKey = z.string().min(8).max(200).optional();

/** The `Idempotency-Key` header wins; batched browser calls send it in the input instead. */
const meta = (ctx: Context & { session: Session }, key: string | undefined) => ({
  actor: { type: "user" as const, id: ctx.session.user.id, name: ctx.session.user.name },
  idempotencyKey: ctx.headers.get("idempotency-key") ?? key,
});

const payer = z
  .object({
    type: z.enum(["insured", "agency", "mortgagee"]),
    ref: z.string().max(200).nullable(),
    name: z.string().trim().max(200).nullable(),
  })
  .nullable();

const applyTarget = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("invoices"),
    allocations: z
      .array(z.object({ invoiceId: z.uuid(), amount: money }))
      .min(1)
      .max(200),
  }),
  z.object({ kind: z.literal("oldest_first"), invoiceIds: z.array(z.uuid()).max(200).optional() }),
  z.object({ kind: z.literal("statement"), statementId: z.uuid(), amount: money }),
]);

type Target = z.infer<typeof applyTarget>;

const targetOf = (t: Target) =>
  t.kind === "invoices"
    ? {
        kind: t.kind,
        allocations: t.allocations.map((a) => ({
          invoiceId: a.invoiceId,
          amount: Money.fromJSON(a.amount),
        })),
      }
    : t.kind === "statement"
      ? { kind: t.kind, statementId: t.statementId, amount: Money.fromJSON(t.amount) }
      : { kind: t.kind, ...(t.invoiceIds && { invoiceIds: t.invoiceIds }) };

const REPORTS = [
  "trial_balance",
  "ar_aging",
  "unapplied_cash",
  "deposits",
  "carrier_payable",
  "taxes_payable",
] as const;

const tenantOf = (ctx: { tenant: TenantContext }) => ctx.tenant;

/** The native billing system (PLAN §13): payments, cash application, journal, reports. */
export const ledgerRouter = router({
  overview: read.query(async ({ ctx }) => ({
    native: await uc(ctx).isNative(ctx.tenant),
    ...(await uc(ctx).reads.settings(ctx.tenant)),
  })),

  accounts: read.query(({ ctx }) => uc(ctx).reads.accounts(tenantOf(ctx))),

  trialBalance: read
    .input(z.object({ asOf: day.optional() }))
    .query(({ ctx, input }) => uc(ctx).reads.trialBalance(ctx.tenant, input)),

  activity: read
    .input(z.object({ account: z.string().max(20), from: day, to: day }))
    .query(({ ctx, input }) => uc(ctx).reads.activity(ctx.tenant, input)),

  entries: read
    .input(
      z.object({
        account: z.string().max(20).optional(),
        policyId: z.uuid().optional(),
        invoiceId: z.uuid().optional(),
        paymentId: z.uuid().optional(),
        from: day.optional(),
        to: day.optional(),
        limit: z.number().int().min(1).max(500).optional(),
      }),
    )
    .query(({ ctx, input }) => uc(ctx).reads.entries(ctx.tenant, input)),

  entry: read.input(z.object({ id: z.uuid() })).query(async ({ ctx, input }) => {
    const entry = await uc(ctx).reads.entry(ctx.tenant, input.id);

    if (!entry) throw new TRPCError({ code: "NOT_FOUND" });

    return entry;
  }),

  audit: read
    .input(
      z.object({
        entityType: z.string().max(40).optional(),
        entityId: z.string().max(80).optional(),
      }),
    )
    .query(({ ctx, input }) => uc(ctx).reads.audit(ctx.tenant, input)),

  payments: read
    .input(
      z.object({
        status: z
          .array(z.enum(["unapplied", "partially_applied", "applied", "reversed"]))
          .max(4)
          .optional(),
        batchId: z.uuid().optional(),
        unappliedOnly: z.boolean().optional(),
        payerType: z.string().max(20).optional(),
        payerRef: z.string().max(200).optional(),
      }),
    )
    .query(({ ctx, input }) => uc(ctx).reads.payments(ctx.tenant, input)),

  payment: read.input(z.object({ id: z.uuid() })).query(async ({ ctx, input }) => {
    const payment = await uc(ctx).reads.payment(ctx.tenant, input.id);

    if (!payment) throw new TRPCError({ code: "NOT_FOUND" });

    return payment;
  }),

  batches: read.query(({ ctx }) => uc(ctx).reads.batches(tenantOf(ctx))),

  payers: read
    .input(z.object({ search: z.string().trim().max(100).optional() }))
    .query(({ ctx, input }) => uc(ctx).reads.payers(ctx.tenant, input)),

  openItems: read
    .input(
      z.object({
        payerType: z.enum(["insured", "agency", "mortgagee"]).optional(),
        payerRef: z.string().max(200).nullable().optional(),
        policyId: z.uuid().optional(),
        search: z.string().trim().max(100).optional(),
      }),
    )
    .query(({ ctx, input }) => uc(ctx).reads.openItems(ctx.tenant, input)),

  lockbox: read.query(({ ctx }) => uc(ctx).reads.lockbox(tenantOf(ctx))),

  lockboxItems: read
    .input(z.object({ importId: z.uuid() }))
    .query(({ ctx, input }) => uc(ctx).reads.lockboxItems(ctx.tenant, input.importId)),

  refunds: read.query(({ ctx }) => uc(ctx).reads.refunds(tenantOf(ctx))),

  writeOffs: read
    .input(z.object({ status: z.enum(["pending_approval", "posted", "rejected"]).optional() }))
    .query(({ ctx, input }) => uc(ctx).reads.writeOffs(ctx.tenant, input)),

  reconciliations: read.query(({ ctx }) => uc(ctx).reads.reconciliations(tenantOf(ctx))),

  aging: read
    .input(z.object({ asOf: day.optional() }))
    .query(({ ctx, input }) => uc(ctx).reads.aging(ctx.tenant, input)),

  carrierPayable: read
    .input(z.object({ asOf: day.optional() }))
    .query(({ ctx, input }) => uc(ctx).reads.carrierPayable(ctx.tenant, input)),

  taxesPayable: read
    .input(z.object({ asOf: day.optional() }))
    .query(({ ctx, input }) => uc(ctx).reads.taxesPayable(ctx.tenant, input)),

  csv: read
    .input(z.object({ report: z.enum(REPORTS), asOf: day.optional() }))
    .query(({ ctx, input }) => uc(ctx).reads.csv(ctx.tenant, input)),

  policyLedger: requirePermission({ policy: ["read"], billing: ["read"] })
    .input(z.object({ policyId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      await ctx.container.useCases.policies.get.detail(
        ctx.tenant,
        await bookScopeOf(ctx, ctx.tenant),
        {
          id: input.policyId,
        },
      );

      const [entries, payments] = await Promise.all([
        uc(ctx).reads.entries(ctx.tenant, { policyId: input.policyId, limit: 200 }),
        uc(ctx).reads.payments(ctx.tenant, { policyId: input.policyId }),
      ]);

      return { native: await uc(ctx).isNative(ctx.tenant), entries, payments };
    }),

  recordPayment: write
    .input(
      z.object({
        rail: z.enum(RAILS),
        payer,
        amount: money,
        receivedOn: day,
        reference: z.string().trim().max(120).nullable(),
        memo: z.string().trim().max(500).nullable(),
        batchId: z.uuid().nullable().optional(),
        apply: applyTarget.optional(),
        idempotencyKey,
      }),
    )
    .mutation(({ ctx, input }) =>
      uc(ctx).recordPayment(ctx.tenant, {
        rail: input.rail,
        payer: input.payer,
        amount: Money.fromJSON(input.amount),
        receivedOn: Temporal.PlainDate.from(input.receivedOn),
        reference: input.reference || null,
        memo: input.memo || null,
        batchId: input.batchId ?? null,
        ...(input.apply && { apply: targetOf(input.apply) }),
        ...meta(ctx, input.idempotencyKey),
      }),
    ),

  applyPayment: write
    .input(z.object({ paymentId: z.uuid(), target: applyTarget, idempotencyKey }))
    .mutation(({ ctx, input }) =>
      uc(ctx).applyPayment(ctx.tenant, {
        paymentId: input.paymentId,
        target: targetOf(input.target),
        ...meta(ctx, input.idempotencyKey),
      }),
    ),

  unapplyPayment: write
    .input(
      z.object({
        paymentId: z.uuid(),
        applicationId: z.uuid(),
        reason: z.string().trim().max(300).optional(),
        idempotencyKey,
      }),
    )
    .mutation(({ ctx, input }) =>
      uc(ctx).unapplyPayment(ctx.tenant, {
        paymentId: input.paymentId,
        applicationId: input.applicationId,
        ...(input.reason && { reason: input.reason }),
        ...meta(ctx, input.idempotencyKey),
      }),
    ),

  reversePayment: write
    .input(
      z.object({
        paymentId: z.uuid(),
        reason: z.enum(Object.keys(REVERSAL_REASONS) as [keyof typeof REVERSAL_REASONS]),
        note: z.string().trim().max(300).optional(),
        idempotencyKey,
      }),
    )
    .mutation(({ ctx, input }) =>
      uc(ctx).reversePayment(ctx.tenant, {
        paymentId: input.paymentId,
        reason: input.reason,
        ...(input.note && { note: input.note }),
        ...meta(ctx, input.idempotencyKey),
      }),
    ),

  refund: write
    .input(
      z.object({
        source: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("credit_balance"), invoiceId: z.uuid() }),
          z.object({ kind: z.literal("unapplied"), paymentId: z.uuid() }),
        ]),
        amount: money,
        method: z.enum(["provider", "check"]),
        idempotencyKey,
      }),
    )
    .mutation(({ ctx, input }) =>
      uc(ctx).refund(ctx.tenant, {
        source: input.source,
        amount: Money.fromJSON(input.amount),
        method: input.method,
        ...meta(ctx, input.idempotencyKey),
      }),
    ),

  issueRefundCheck: write
    .input(
      z.object({
        refundId: z.uuid(),
        checkNumber: z.string().trim().min(1).max(40),
        idempotencyKey,
      }),
    )
    .mutation(({ ctx, input }) =>
      uc(ctx).issueRefundCheck(ctx.tenant, {
        refundId: input.refundId,
        checkNumber: input.checkNumber,
        ...meta(ctx, input.idempotencyKey),
      }),
    ),

  requestWriteOff: write
    .input(
      z.object({
        invoiceId: z.uuid(),
        amount: money,
        reason: z.string().trim().min(1).max(300),
        idempotencyKey,
      }),
    )
    .mutation(({ ctx, input }) =>
      uc(ctx).requestWriteOff(ctx.tenant, {
        invoiceId: input.invoiceId,
        amount: Money.fromJSON(input.amount),
        reason: input.reason,
        ...meta(ctx, input.idempotencyKey),
      }),
    ),

  decideWriteOff: write
    .input(z.object({ writeOffId: z.uuid(), approve: z.boolean(), idempotencyKey }))
    .mutation(({ ctx, input }) =>
      uc(ctx).decideWriteOff(ctx.tenant, {
        writeOffId: input.writeOffId,
        approve: input.approve,
        ...meta(ctx, input.idempotencyKey),
      }),
    ),

  reverseWriteOff: write
    .input(
      z.object({ writeOffId: z.uuid(), reason: z.string().trim().min(1).max(300), idempotencyKey }),
    )
    .mutation(({ ctx, input }) =>
      uc(ctx).reverseWriteOff(ctx.tenant, {
        writeOffId: input.writeOffId,
        reason: input.reason,
        ...meta(ctx, input.idempotencyKey),
      }),
    ),

  applyCredit: write
    .input(z.object({ creditNoteId: z.uuid(), invoiceId: z.uuid(), amount: money, idempotencyKey }))
    .mutation(({ ctx, input }) =>
      uc(ctx).applyCredit(ctx.tenant, {
        creditNoteId: input.creditNoteId,
        invoiceId: input.invoiceId,
        amount: Money.fromJSON(input.amount),
        ...meta(ctx, input.idempotencyKey),
      }),
    ),

  openBatch: write
    .input(z.object({ rail: z.enum(["check", "lockbox"]), idempotencyKey }))
    .mutation(({ ctx, input }) =>
      uc(ctx).batches.open(ctx.tenant, { rail: input.rail, ...meta(ctx, input.idempotencyKey) }),
    ),

  depositBatch: write
    .input(z.object({ batchId: z.uuid(), depositedOn: day, idempotencyKey }))
    .mutation(({ ctx, input }) =>
      uc(ctx).batches.deposit(ctx.tenant, {
        batchId: input.batchId,
        depositedOn: Temporal.PlainDate.from(input.depositedOn),
        ...meta(ctx, input.idempotencyKey),
      }),
    ),

  importLockbox: write
    .input(
      z.object({
        fileName: z.string().trim().min(1).max(200),
        csv: z.string().min(1).max(2_000_000),
        currency: z.string().length(3),
        idempotencyKey,
      }),
    )
    .mutation(({ ctx, input }) =>
      uc(ctx).lockbox.import(ctx.tenant, {
        fileName: input.fileName,
        csv: input.csv,
        currency: input.currency,
        ...meta(ctx, input.idempotencyKey),
      }),
    ),

  resolveLockbox: write
    .input(z.object({ itemId: z.uuid(), invoiceId: z.uuid(), idempotencyKey }))
    .mutation(({ ctx, input }) =>
      uc(ctx).lockbox.resolve(ctx.tenant, {
        itemId: input.itemId,
        invoiceId: input.invoiceId,
        ...meta(ctx, input.idempotencyKey),
      }),
    ),

  reconcile: write.mutation(async ({ ctx }) => {
    const run = await uc(ctx).reconcile(ctx.tenant);

    return { id: run.id, status: run.status, differences: run.differences.length };
  }),

  updateSettings: write
    .input(z.object({ smallBalanceWriteOff: money.nullable(), idempotencyKey }))
    .mutation(({ ctx, input }) =>
      uc(ctx).updateSettings(ctx.tenant, {
        smallBalanceWriteOff: input.smallBalanceWriteOff
          ? Money.fromJSON(input.smallBalanceWriteOff)
          : null,
        ...meta(ctx, input.idempotencyKey),
      }),
    ),
});
