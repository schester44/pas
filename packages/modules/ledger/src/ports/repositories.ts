import type { Instant, Money, PlainDate, TenantContext, Transaction } from "@pas/kernel";
import type { AccountTemplate, PayerType, Rail } from "../domain/accounts";
import type { EntryActor, JournalEntry } from "../domain/journal";
import type { Payment } from "../domain/payment";
import type { Receivable, RefundMethod } from "../domain/posting-rules";
import type { Difference } from "../domain/reconciliation";
import type { CommissionBasis } from "../domain/commission";
import type { WriteOffStatus } from "../domain/write-off";

export interface JournalRepository {
  ensureChart(
    tx: Transaction,
    ctx: TenantContext,
    accounts: readonly AccountTemplate[],
    now: Instant,
  ): Promise<void>;
  findByKey(tx: Transaction, ctx: TenantContext, key: string): Promise<JournalEntry | null>;
  findById(tx: Transaction, ctx: TenantContext, id: string): Promise<JournalEntry | null>;
  isReversed(tx: Transaction, ctx: TenantContext, id: string): Promise<boolean>;
  /** Sum of the lines on an account for one invoice. */
  invoiceTotal(
    tx: Transaction,
    ctx: TenantContext,
    account: string,
    invoiceId: string,
    currency: string,
  ): Promise<Money>;
  /** Exactly once per key: a repeated key returns the entry already posted, untouched. */
  post(
    tx: Transaction,
    ctx: TenantContext,
    entry: JournalEntry,
  ): Promise<{ entry: JournalEntry; posted: boolean }>;
}

export interface ReceivableRecord extends Receivable {
  payerName: string | null;
  currency: string;
  total: Money;
  issuedOn: PlainDate;
  dueOn: PlainDate;
  statementId: string | null;
  statementNumber: string | null;
  /** When it became a bill; until then its installment fee isn't owed or booked. */
  billedOn: PlainDate | null;
}

export interface ReceivableRepository {
  find(tx: Transaction, ctx: TenantContext, invoiceId: string): Promise<ReceivableRecord | null>;
  save(
    tx: Transaction,
    ctx: TenantContext,
    receivable: ReceivableRecord,
    now: Instant,
  ): Promise<void>;
  onStatement(
    tx: Transaction,
    ctx: TenantContext,
    statement: { id: string; number: string; dueOn: PlainDate; invoiceIds: readonly string[] },
  ): Promise<void>;
  /** Receivable balances from the journal: the AR lines carrying each invoice. */
  balances(
    tx: Transaction,
    ctx: TenantContext,
    filter?: { invoiceIds?: readonly string[] },
  ): Promise<Map<string, Money>>;
  list(
    tx: Transaction,
    ctx: TenantContext,
    filter: {
      payerType?: PayerType;
      payerRef?: string;
      policyId?: string;
      openOnly?: boolean;
      limit?: number;
    },
  ): Promise<(ReceivableRecord & { balance: Money })[]>;
}

export interface CommissionRecord {
  financialTransactionId: string;
  policyId: string;
  agencyId: string;
  amount: Money;
  basis: CommissionBasis;
  recordedAt: Instant;
}

export interface CommissionRepository {
  record(tx: Transaction, ctx: TenantContext, commission: CommissionRecord): Promise<boolean>;
  /** Collected-basis commission per agency on a policy. */
  collectedTotals(
    tx: Transaction,
    ctx: TenantContext,
    policyId: string,
  ): Promise<{ agencyId: string; amount: Money }[]>;
  /** Commission payable already accrued as collected, for one agency on a policy. */
  accrued(
    tx: Transaction,
    ctx: TenantContext,
    policyId: string,
    agencyId: string,
    currency: string,
  ): Promise<Money>;
  /** Receivable charged and collected on a policy, from the journal's entry kinds. */
  collection(
    tx: Transaction,
    ctx: TenantContext,
    input: {
      policyId: string;
      currency: string;
      chargeKinds: readonly string[];
      collectionKinds: readonly string[];
    },
  ): Promise<{ charged: Money; collected: Money }>;
}

export interface PaymentRepository {
  nextNumber(
    tx: Transaction,
    ctx: TenantContext,
    kind: "payment" | "batch" | "refund",
  ): Promise<number>;
  find(tx: Transaction, ctx: TenantContext, id: string): Promise<Payment | null>;
  findByProvider(
    tx: Transaction,
    ctx: TenantContext,
    provider: string,
    providerRef: string,
  ): Promise<Payment | null>;
  /** Optimistic: a payment changed since it was loaded fails with a conflict. */
  save(tx: Transaction, ctx: TenantContext, payment: Payment): Promise<void>;
}

export interface DepositBatchRecord {
  id: string;
  number: string;
  rail: Rail;
  status: "open" | "deposited";
  depositedOn: PlainDate | null;
  createdAt: Instant;
}

export interface DepositBatchRepository {
  find(tx: Transaction, ctx: TenantContext, id: string): Promise<DepositBatchRecord | null>;
  openFor(tx: Transaction, ctx: TenantContext, rail: Rail): Promise<DepositBatchRecord | null>;
  save(tx: Transaction, ctx: TenantContext, batch: DepositBatchRecord, now: Instant): Promise<void>;
  total(tx: Transaction, ctx: TenantContext, id: string): Promise<Money | null>;
}

export interface LockboxItemRecord {
  id: string;
  importId: string;
  row: number;
  raw: Record<string, string>;
  amount: Money;
  reference: string | null;
  matchedBy: string | null;
  status: "matched" | "exception" | "resolved";
  reason: string | null;
  paymentId: string | null;
  invoiceId: string | null;
}

export interface LockboxRepository {
  saveImport(
    tx: Transaction,
    ctx: TenantContext,
    input: {
      id: string;
      fileName: string;
      batchId: string;
      rows: number;
      matched: number;
      exceptions: number;
      importedAt: Instant;
    },
  ): Promise<void>;
  findItem(tx: Transaction, ctx: TenantContext, id: string): Promise<LockboxItemRecord | null>;
  saveItem(
    tx: Transaction,
    ctx: TenantContext,
    item: LockboxItemRecord,
    now: Instant,
  ): Promise<void>;
}

export interface RefundRecord {
  id: string;
  number: string;
  source: "credit_balance" | "unapplied";
  paymentId: string | null;
  invoiceId: string | null;
  payerName: string | null;
  amount: Money;
  method: RefundMethod;
  status: "requested" | "issued";
  checkNumber: string | null;
  providerRef: string | null;
  createdAt: Instant;
}

export interface RefundRepository {
  find(tx: Transaction, ctx: TenantContext, id: string): Promise<RefundRecord | null>;
  save(tx: Transaction, ctx: TenantContext, refund: RefundRecord, now: Instant): Promise<void>;
}

export interface WriteOffRecord {
  id: string;
  invoiceId: string;
  amount: Money;
  reason: string;
  status: WriteOffStatus;
  requestedBy: { id: string; name: string };
  decidedBy: { id: string; name: string } | null;
  createdAt: Instant;
}

export interface WriteOffRepository {
  find(tx: Transaction, ctx: TenantContext, id: string): Promise<WriteOffRecord | null>;
  save(tx: Transaction, ctx: TenantContext, writeOff: WriteOffRecord, now: Instant): Promise<void>;
}

export interface LedgerSettings {
  currency: string;
  receivableBasis: "installment" | "written";
  smallBalanceWriteOff: Money | null;
  openedAt: Instant;
}

export interface SettingsRepository {
  find(tx: Transaction, ctx: TenantContext): Promise<LedgerSettings | null>;
  save(tx: Transaction, ctx: TenantContext, settings: LedgerSettings, now: Instant): Promise<void>;
}

export interface IdempotencyStore {
  /** Claims the key in this transaction; a key already used returns what it stored. */
  claim(
    tx: Transaction,
    ctx: TenantContext,
    input: { key: string; action: string; requestHash: string; now: Instant },
  ): Promise<
    { claimed: true } | { claimed: false; action: string; requestHash: string; response: unknown }
  >;
  complete(tx: Transaction, ctx: TenantContext, key: string, response: unknown): Promise<void>;
}

export interface AuditRecord {
  action: string;
  entityType: string;
  entityId: string;
  actor: EntryActor;
  before: unknown;
  after: unknown;
  idempotencyKey: string | null;
  occurredAt: Instant;
}

export interface AuditTrail {
  record(tx: Transaction, ctx: TenantContext, entry: AuditRecord): Promise<void>;
}

export interface ReconciliationRecord {
  id: string;
  asOf: PlainDate;
  ranAt: Instant;
  status: "balanced" | "differences";
  ledgerTotal: Money;
  pasTotal: Money;
  invoices: number;
  differences: Difference[];
  cacheDrift: { account: string; currency: string; cached: Money; derived: Money }[];
}

export interface ReconciliationRepository {
  save(tx: Transaction, ctx: TenantContext, run: ReconciliationRecord): Promise<void>;
  cachedVsDerived(
    tx: Transaction,
    ctx: TenantContext,
  ): Promise<{ account: string; currency: string; cached: Money; derived: Money }[]>;
}
