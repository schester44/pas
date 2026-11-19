import type { TenantContext } from "@pas/kernel";

export type MoneyDto = { amount: string; currency: string };

export interface EntryLineDto {
  account: string;
  accountName: string;
  debit: MoneyDto | null;
  credit: MoneyDto | null;
  payerType: string | null;
  payerRef: string | null;
  policyId: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  paymentId: string | null;
  agencyId: string | null;
  jurisdiction: string | null;
}

export interface EntryDto {
  id: string;
  number: number;
  kind: string;
  memo: string;
  effectiveOn: string;
  recordedAt: string;
  actor: { type: string; id: string | null; name: string };
  source: { type: string; id: string };
  idempotencyKey: string;
  billingEventId: string | null;
  reversesId: string | null;
  reversedById: string | null;
  total: MoneyDto;
  lines: EntryLineDto[];
}

export interface EntryFilter {
  account?: string;
  policyId?: string;
  invoiceId?: string;
  paymentId?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export interface AccountBalanceDto {
  code: string;
  name: string;
  type: string;
  role: string;
  currency: string;
  balance: string;
  version: number;
}

export interface ApplicationDto {
  id: string;
  invoiceId: string;
  invoiceNumber: string | null;
  policyId: string;
  policyNumber: string | null;
  statementId: string | null;
  amount: MoneyDto;
  status: string;
  appliedAt: string;
  reversedAt: string | null;
}

export interface PaymentDto {
  id: string;
  number: string;
  rail: string;
  payerType: string | null;
  payerRef: string | null;
  payerName: string | null;
  amount: MoneyDto;
  applied: MoneyDto;
  refunded: MoneyDto;
  unapplied: MoneyDto;
  receivedOn: string;
  reference: string | null;
  provider: string | null;
  batchId: string | null;
  batchNumber: string | null;
  status: string;
  reversalReason: string | null;
  memo: string | null;
  createdAt: string;
  applications: ApplicationDto[];
}

export interface PaymentFilter {
  status?: readonly string[];
  batchId?: string;
  payerType?: string;
  payerRef?: string;
  policyId?: string;
  unappliedOnly?: boolean;
  limit?: number;
}

export interface BatchDto {
  id: string;
  number: string;
  rail: string;
  status: string;
  depositedOn: string | null;
  payments: number;
  total: MoneyDto | null;
  createdAt: string;
}

export interface OpenItemDto {
  invoiceId: string;
  number: string;
  kind: string;
  policyId: string;
  policyNumber: string;
  payerType: string;
  payerRef: string | null;
  payerName: string | null;
  statementId: string | null;
  statementNumber: string | null;
  issuedOn: string;
  dueOn: string;
  total: MoneyDto;
  balance: MoneyDto;
}

export interface PayerDto {
  payerType: string;
  payerRef: string | null;
  payerName: string;
  openItems: number;
  balance: MoneyDto;
  unapplied: MoneyDto;
}

export interface LockboxImportDto {
  id: string;
  fileName: string;
  batchId: string;
  rows: number;
  matched: number;
  exceptions: number;
  importedAt: string;
}

export interface LockboxItemDto {
  id: string;
  importId: string;
  fileName: string;
  row: number;
  raw: Record<string, string>;
  amount: MoneyDto;
  reference: string | null;
  matchedBy: string | null;
  status: string;
  reason: string | null;
  paymentId: string | null;
  paymentNumber: string | null;
  invoiceId: string | null;
}

export interface RefundDto {
  id: string;
  number: string;
  source: string;
  paymentId: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  payerName: string | null;
  amount: MoneyDto;
  method: string;
  status: string;
  checkNumber: string | null;
  createdAt: string;
}

export interface WriteOffDto {
  id: string;
  invoiceId: string;
  invoiceNumber: string | null;
  policyNumber: string | null;
  amount: MoneyDto;
  reason: string;
  status: string;
  requestedBy: string;
  requestedById: string;
  decidedBy: string | null;
  createdAt: string;
}

export interface ReconciliationDto {
  id: string;
  asOf: string;
  ranAt: string;
  status: string;
  ledgerTotal: MoneyDto;
  pasTotal: MoneyDto;
  invoices: number;
  differences: {
    invoiceId: string;
    number: string;
    ledger: MoneyDto;
    pas: MoneyDto;
    difference: MoneyDto;
  }[];
  cacheDrift: { account: string; currency: string; cached: string; derived: string }[];
}

export interface AuditDto {
  id: string;
  occurredAt: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
}

/** Read models over the ledger's own tables. */
export interface LedgerQueries {
  entries(ctx: TenantContext, filter: EntryFilter): Promise<EntryDto[]>;
  entry(ctx: TenantContext, id: string): Promise<EntryDto | null>;
  accountBalances(ctx: TenantContext): Promise<AccountBalanceDto[]>;
  /** Signed balance per account and currency from lines effective on or before `asOf`. */
  balancesAsOf(
    ctx: TenantContext,
    asOf: string,
  ): Promise<{ code: string; currency: string; balance: string }[]>;
  linesFor(
    ctx: TenantContext,
    input: { account: string; from: string; to: string },
  ): Promise<{ opening: { currency: string; balance: string }[]; entries: EntryDto[] }>;
  payments(ctx: TenantContext, filter: PaymentFilter): Promise<PaymentDto[]>;
  payment(ctx: TenantContext, id: string): Promise<PaymentDto | null>;
  batches(ctx: TenantContext): Promise<BatchDto[]>;
  openItems(
    ctx: TenantContext,
    filter: { payerType?: string; payerRef?: string | null; policyId?: string; search?: string },
  ): Promise<OpenItemDto[]>;
  payers(ctx: TenantContext, input: { search?: string }): Promise<PayerDto[]>;
  lockboxImports(ctx: TenantContext): Promise<LockboxImportDto[]>;
  lockboxItems(
    ctx: TenantContext,
    filter: { importId?: string; status?: string },
  ): Promise<LockboxItemDto[]>;
  refunds(ctx: TenantContext): Promise<RefundDto[]>;
  writeOffs(ctx: TenantContext, filter: { status?: string }): Promise<WriteOffDto[]>;
  reconciliations(ctx: TenantContext, limit: number): Promise<ReconciliationDto[]>;
  taxesByJurisdiction(
    ctx: TenantContext,
    asOf: string,
  ): Promise<{ jurisdiction: string; currency: string; balance: string }[]>;
  premiumPayable(
    ctx: TenantContext,
    asOf: string,
  ): Promise<
    {
      policyId: string;
      policyNumber: string | null;
      currency: string;
      gross: string;
      commission: string;
      net: string;
    }[]
  >;
  audit(
    ctx: TenantContext,
    filter: { entityType?: string; entityId?: string; limit: number },
  ): Promise<AuditDto[]>;
}
