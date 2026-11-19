import type { Money, PlainDate, TenantContext, Transaction } from "@pas/kernel";
import type { AgencyStatement, StatementStatus } from "../domain/agency-statement";

export interface StatementRef {
  statementId: string;
  number: string;
  status: StatementStatus;
  dueOn: PlainDate;
}

export interface AgencyStatementRepository {
  save(tx: Transaction, ctx: TenantContext, statement: AgencyStatement): Promise<void>;
  findById(tx: Transaction, ctx: TenantContext, id: string): Promise<AgencyStatement | null>;
  findByPeriod(
    tx: Transaction,
    ctx: TenantContext,
    agencyId: string,
    periodEnd: PlainDate,
  ): Promise<AgencyStatement | null>;
  latestFor(tx: Transaction, ctx: TenantContext, agencyId: string): Promise<AgencyStatement | null>;
  list(
    tx: Transaction,
    ctx: TenantContext,
    filter: { agencyIds?: readonly string[]; statuses?: readonly StatementStatus[]; limit: number },
  ): Promise<AgencyStatement[]>;
  /** Which statement each agency-billed invoice is on. */
  forInvoices(
    tx: Transaction,
    ctx: TenantContext,
    invoiceIds: readonly string[],
  ): Promise<Map<string, StatementRef>>;
  nextSequence(tx: Transaction, ctx: TenantContext): Promise<number>;
  /** Agency-billed invoices and credit notes issued through `through` that no statement carries yet. */
  unstatemented(
    tx: Transaction,
    ctx: TenantContext,
    agencyId: string,
    through: PlainDate,
  ): Promise<string[]>;
  /** What the agency owes on its agency-billed invoices, net of open credits. */
  agencyBalance(
    tx: Transaction,
    ctx: TenantContext,
    agencyId: string,
    currency: string,
  ): Promise<Money>;
}
