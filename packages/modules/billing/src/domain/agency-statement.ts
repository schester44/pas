import {
  type Clock,
  conflict,
  type Instant,
  invalid,
  Money,
  newId,
  type PlainDate,
  type TenantId,
} from "@pas/kernel";

export type RemittanceBasis = "gross" | "net";

export type StatementStatus = "open" | "partially_paid" | "paid" | "past_due" | "credit";

/**
 * One agency-billed invoice (positive) or credit note (negative) on an account current. `due` is
 * what the agency remits for it: the gross, or the net of commission. `credited` is what returns on
 * the same statement covered (on a credit note: how much of its credit was used); `paid` is cash.
 */
export interface StatementItem {
  id: string;
  position: number;
  invoiceId: string;
  invoiceNumber: string;
  invoiceKind: "invoice" | "credit_note";
  policyId: string;
  policyNumber: string;
  insuredName: string;
  transactionId: string;
  transactionType: string;
  effectiveDate: PlainDate;
  gross: Money;
  commission: Money;
  net: Money;
  due: Money;
  credited: Money;
  paid: Money;
  /** What was credited to the invoice when the item settled (commission kept, returns netted). */
  settlementCredit: Money;
}

export type StatementLine = Omit<
  StatementItem,
  "id" | "position" | "net" | "due" | "credited" | "paid" | "settlementCredit"
>;

export interface StatementTotals {
  gross: Money;
  commission: Money;
  net: Money;
  due: Money;
  paid: Money;
  balance: Money;
}

export interface Allocation {
  itemId: string;
  invoiceId: string;
  amount: Money;
  /** The item is fully paid after this allocation (or was, before a reversal). */
  settled: boolean;
}

const min = (a: Money, b: Money) => (a.amount.lessThan(b.amount) ? a : b);
const positive = (m: Money) => m.amount.greaterThan(0);
const isDebit = (item: StatementItem) => positive(item.due);

export const openOf = (item: StatementItem): Money =>
  isDebit(item) ? item.due.minus(item.credited).minus(item.paid) : item.due.minus(item.due);

/** Gross, commission and net for one transaction, and what the agency owes for it. */
export function statementAmounts(
  gross: Money,
  commission: Money,
  basis: RemittanceBasis,
): Pick<StatementItem, "gross" | "commission" | "net" | "due"> {
  const net = gross.minus(commission);

  return { gross, commission, net, due: basis === "net" ? net : gross };
}

export function statementTotals(
  items: readonly StatementItem[],
  currency: string,
): StatementTotals {
  const sum = (pick: (i: StatementItem) => Money, of = items) =>
    of.reduce((total, i) => total.plus(pick(i)), Money.zero(currency));

  return {
    gross: sum((i) => i.gross),
    commission: sum((i) => i.commission),
    net: sum((i) => i.net),
    due: sum((i) => i.due),
    paid: sum((i) => i.paid),
    balance: sum(openOf, items.filter(isDebit)),
  };
}

/** Returns on the statement pay down its other items first, oldest first. */
export function netCredits(items: readonly StatementItem[]): StatementItem[] {
  const result = items.map((i) => ({ ...i }));
  const debits = result.filter(isDebit);

  for (const credit of result.filter((i) => i.due.isNegative())) {
    let available = credit.due.negated().minus(credit.credited);

    for (const debit of debits) {
      if (!positive(available)) break;

      const take = min(available, openOf(debit));

      if (!positive(take)) continue;

      debit.credited = debit.credited.plus(take);
      credit.credited = credit.credited.plus(take);
      available = available.minus(take);
    }
  }

  return result;
}

/** Applies a remittance across open items, oldest first; partial payments leave an item open. */
export function allocatePayment(
  items: readonly StatementItem[],
  amount: Money,
): { items: StatementItem[]; allocations: Allocation[] } {
  if (!positive(amount)) throw invalid("Payments must be positive");

  const result = items.map((i) => ({ ...i }));
  const balance = statementTotals(result, amount.currency).balance;

  if (amount.amount.greaterThan(balance.amount)) {
    throw conflict("The payment is more than the statement balance");
  }

  const allocations: Allocation[] = [];
  let left = amount;

  for (const item of result.filter(isDebit)) {
    if (!positive(left)) break;

    const take = min(left, openOf(item));

    if (!positive(take)) continue;

    item.paid = item.paid.plus(take);
    left = left.minus(take);

    allocations.push({
      itemId: item.id,
      invoiceId: item.invoiceId,
      amount: take,
      settled: openOf(item).isZero(),
    });
  }

  return { items: result, allocations };
}

/** Takes back a returned remittance from the most recently paid items first; they reopen. */
export function reversePayment(
  items: readonly StatementItem[],
  amount: Money,
): { items: StatementItem[]; reversals: Allocation[] } {
  if (!positive(amount)) throw invalid("Reversals must be positive");

  const result = items.map((i) => ({ ...i }));
  const paid = result.reduce((sum, i) => sum.plus(i.paid), Money.zero(amount.currency));

  if (amount.amount.greaterThan(paid.amount)) {
    throw conflict("The reversal is more than was paid on the statement");
  }

  const reversals: Allocation[] = [];
  let left = amount;

  for (const item of result.filter(isDebit).toReversed()) {
    if (!positive(left)) break;

    const take = min(left, item.paid);

    if (!positive(take)) continue;

    const settled = openOf(item).isZero();

    item.paid = item.paid.minus(take);
    left = left.minus(take);
    reversals.push({ itemId: item.id, invoiceId: item.invoiceId, amount: take, settled });
  }

  return { items: result, reversals };
}

export interface AgencyStatementProps {
  id: string;
  tenantId: TenantId;
  agencyId: string;
  agencyName: string;
  number: string;
  periodStart: PlainDate;
  periodEnd: PlainDate;
  issuedOn: PlainDate;
  dueOn: PlainDate;
  remittanceBasis: RemittanceBasis;
  currency: string;
  status: StatementStatus;
  items: StatementItem[];
  remindedOn: PlainDate | null;
  suspendedOn: PlainDate | null;
  documentKey: string | null;
  emailedTo: string[];
  createdAt: Instant;
  updatedAt: Instant;
}

/** An agency's monthly account current (PLAN §13): what it owes for its agency-billed business. */
export class AgencyStatement {
  private constructor(private props: AgencyStatementProps) {}

  static issue(
    input: Omit<
      AgencyStatementProps,
      | "id"
      | "status"
      | "items"
      | "remindedOn"
      | "suspendedOn"
      | "documentKey"
      | "emailedTo"
      | "createdAt"
      | "updatedAt"
    > & { lines: StatementLine[]; commissionOf: (line: StatementLine) => Money },
    clock: Clock,
  ): AgencyStatement {
    const now = clock.now();
    const { lines, commissionOf, ...rest } = input;
    const zero = Money.zero(input.currency);

    const items = netCredits(
      lines
        .toSorted(
          (a, b) =>
            Temporal.PlainDate.compare(a.effectiveDate, b.effectiveDate) ||
            a.invoiceNumber.localeCompare(b.invoiceNumber),
        )
        .map((line, position) => ({
          ...line,
          ...statementAmounts(line.gross, commissionOf(line), input.remittanceBasis),
          id: newId(),
          position,
          credited: zero,
          paid: zero,
          settlementCredit: zero,
        })),
    );

    const statement = new AgencyStatement({
      ...rest,
      id: newId(),
      status: "open",
      items,
      remindedOn: null,
      suspendedOn: null,
      documentKey: null,
      emailedTo: [],
      createdAt: now,
      updatedAt: now,
    });

    statement.settle(clock);

    return statement;
  }

  static restore(props: AgencyStatementProps): AgencyStatement {
    return new AgencyStatement(props);
  }

  get id(): string {
    return this.props.id;
  }

  get status(): StatementStatus {
    return this.props.status;
  }

  get items(): readonly StatementItem[] {
    return this.props.items;
  }

  get totals(): StatementTotals {
    return statementTotals(this.props.items, this.props.currency);
  }

  get isSettled(): boolean {
    return this.props.status === "paid" || this.props.status === "credit";
  }

  applyPayment(amount: Money, clock: Clock): Allocation[] {
    const { items, allocations } = allocatePayment(this.props.items, amount);

    this.props = { ...this.props, items };
    this.settle(clock);

    return allocations;
  }

  /** A returned remittance reopens items; past the due date the statement is past due again. */
  reversePayment(amount: Money, today: PlainDate, clock: Clock): Allocation[] {
    const { items, reversals } = reversePayment(this.props.items, amount);
    const late = Temporal.PlainDate.compare(today, this.props.dueOn) > 0;

    this.props = { ...this.props, items, ...(late && { status: "past_due" as const }) };
    this.settle(clock);

    return reversals;
  }

  recordSettlementCredit(itemId: string, amount: Money, clock: Clock): void {
    this.props = {
      ...this.props,
      items: this.props.items.map((i) =>
        i.id === itemId ? { ...i, settlementCredit: amount } : i,
      ),
      updatedAt: clock.now(),
    };
  }

  markPastDue(clock: Clock): boolean {
    if (this.isSettled || this.props.status === "past_due") return false;

    this.props = { ...this.props, status: "past_due", updatedAt: clock.now() };

    return true;
  }

  remind(on: PlainDate, clock: Clock): void {
    this.props = { ...this.props, remindedOn: on, updatedAt: clock.now() };
  }

  suspend(on: PlainDate, clock: Clock): void {
    this.props = { ...this.props, suspendedOn: on, updatedAt: clock.now() };
  }

  attachDocument(key: string, emailedTo: string[], clock: Clock): void {
    this.props = { ...this.props, documentKey: key, emailedTo, updatedAt: clock.now() };
  }

  toSnapshot(): Readonly<AgencyStatementProps> {
    return this.props;
  }

  private settle(clock: Clock): void {
    const totals = this.totals;
    const hasDebits = this.props.items.some(isDebit);

    const status: StatementStatus = !hasDebits
      ? "credit"
      : totals.balance.isZero()
        ? "paid"
        : this.props.status === "past_due"
          ? "past_due"
          : positive(totals.paid)
            ? "partially_paid"
            : "open";

    this.props = { ...this.props, status, updatedAt: clock.now() };
  }
}
