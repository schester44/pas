import type { ClockProvider, Outbox, TenantContext, UnitOfWork } from "@pas/kernel";
import { makeApplyCredit } from "../application/apply-credit";
import { makeApplyPayment, makeUnapplyPayment } from "../application/apply-payment";
import type { LedgerDeps } from "../application/deps";
import { makeCatchUp } from "../application/catch-up";
import { makeDepositBatches } from "../application/deposit-batches";
import { makeIngestBillingFact } from "../application/ingest-billing-fact";
import { makeLockbox } from "../application/lockbox";
import { makeOpenLedger } from "../application/open-ledger";
import { makeReadLedger, makeUpdateLedgerSettings } from "../application/read-ledger";
import { makeReconcile } from "../application/reconcile";
import { makeRecordCardPayment, makeRecordPayment } from "../application/record-payment";
import { makeIssueRefundCheck, makeRefund } from "../application/refund";
import { makeReversePayment } from "../application/reverse-payment";
import {
  makeDecideWriteOff,
  makeRequestWriteOff,
  makeReverseWriteOff,
} from "../application/write-off";
import type { CardRefunds, PasBilling } from "../ports/pas-billing";
import { parseBillingFact } from "./billing-facts";
import { PrismaJournalRepository } from "./prisma-journal-repository";
import { PrismaLedgerQueries } from "./prisma-ledger-queries";
import {
  PrismaAuditTrail,
  PrismaCommissionRepository,
  PrismaDepositBatchRepository,
  PrismaIdempotencyStore,
  PrismaLockboxRepository,
  PrismaPaymentRepository,
  PrismaReceivableRepository,
  PrismaReconciliationRepository,
  PrismaRefundRepository,
  PrismaSettingsRepository,
  PrismaWriteOffRepository,
} from "./prisma-ledger-repositories";

/** The native billing system (ledger), shared by the api and worker composition roots. */
export function composeLedger(deps: {
  uow: UnitOfWork;
  outbox: Outbox;
  clocks: ClockProvider;
  pas: Omit<PasBilling, "history"> & {
    history(ctx: TenantContext): Promise<{
      invoices: unknown[];
      opened: unknown[];
      events: unknown[];
      commissions?: unknown[];
    }>;
  };
  cards: CardRefunds;
}) {
  const pas: PasBilling = {
    invoices: (ctx) => deps.pas.invoices(ctx),
    apply: (ctx, events, actor) => deps.pas.apply(ctx, events, actor),
    async history(ctx) {
      const { invoices, opened, events, commissions = [] } = await deps.pas.history(ctx);

      return [
        ...invoices.map((data) => parseBillingFact("billing.invoice_issued", data)),
        ...events.map((data) => parseBillingFact("billing.event_applied", data)),
        ...opened.map((data) => parseBillingFact("billing.invoice_opened", data)),
        ...commissions.map((data) => parseBillingFact("distribution.commissions_recorded", data)),
      ].filter((fact) => fact !== null);
    },
  };

  const base: LedgerDeps = {
    ...deps,
    pas,
    journal: new PrismaJournalRepository(),
    receivables: new PrismaReceivableRepository(),
    commissions: new PrismaCommissionRepository(),
    payments: new PrismaPaymentRepository(),
    batches: new PrismaDepositBatchRepository(),
    lockbox: new PrismaLockboxRepository(),
    refunds: new PrismaRefundRepository(),
    writeOffs: new PrismaWriteOffRepository(),
    settings: new PrismaSettingsRepository(),
    idempotency: new PrismaIdempotencyStore(),
    audit: new PrismaAuditTrail(),
    reconciliations: new PrismaReconciliationRepository(),
    queries: new PrismaLedgerQueries(deps.uow),
  };

  const open = makeOpenLedger(base);
  const full = { ...base, open };
  const ingest = makeIngestBillingFact(full);
  const catchUp = makeCatchUp({ pas, ingest });

  return {
    open,
    /** One of PAS's outbound billing facts, as the native billing system receives it. */
    async ingest(ctx: TenantContext, type: string, data: unknown) {
      const fact = parseBillingFact(type, data);

      return fact ? ingest(ctx, fact) : { posted: false };
    },
    recordPayment: makeRecordPayment(full),
    recordCardPayment: makeRecordCardPayment(full),
    applyPayment: makeApplyPayment(full),
    unapplyPayment: makeUnapplyPayment(full),
    reversePayment: makeReversePayment(full),
    refund: makeRefund(full),
    issueRefundCheck: makeIssueRefundCheck(full),
    requestWriteOff: makeRequestWriteOff(full),
    decideWriteOff: makeDecideWriteOff(full),
    reverseWriteOff: makeReverseWriteOff(full),
    applyCredit: makeApplyCredit(full),
    batches: makeDepositBatches(full),
    lockbox: makeLockbox(full),
    catchUp,
    reconcile: makeReconcile({ ...full, catchUp }),
    reads: makeReadLedger(full),
    updateSettings: makeUpdateLedgerSettings(full),
  };
}

export type Ledger = ReturnType<typeof composeLedger>;
