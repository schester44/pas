import {
  type Clock,
  conflict,
  type Id,
  type Instant,
  invalid,
  type Money,
  newId,
  type PlainDate,
  type TenantId,
} from "@pas/kernel";
import { type Charge, type InvoiceDraft, totalOf } from "./invoice-lines";

export type InvoiceId = Id<"Invoice">;
export type InvoiceStatus = "scheduled" | "open" | "past_due" | "partially_paid" | "paid" | "void";

export type Payer = "insured" | "agency" | "mortgagee";

export interface InvoiceProps {
  id: InvoiceId;
  tenantId: TenantId;
  number: string;
  kind: InvoiceDraft["kind"];
  policyId: string;
  policyNumber: string;
  transactionId: string;
  scheduleId: string | null;
  installment: number;
  installments: number;
  payer: Payer;
  payerRef: string | null;
  lines: Charge[];
  total: Money;
  amountPaid: Money;
  amountCredited: Money;
  amountWrittenOff: Money;
  status: InvoiceStatus;
  issuedOn: PlainDate;
  dueOn: PlainDate;
  createdAt: Instant;
  updatedAt: Instant;
}

export interface PaymentProps {
  id: string;
  kind: "payment" | "refund" | "reversal";
  policyId: string;
  invoiceId: InvoiceId;
  provider: string;
  providerRef: string;
  method: Record<string, unknown>;
  amount: Money;
  receivedAt: Instant;
}

const UNPAID: readonly InvoiceStatus[] = ["scheduled", "open", "past_due", "partially_paid"];

/**
 * One bill for one financial transaction, or one installment of it. Money moves it only through
 * applied billing events (payments, refunds, credits, write-offs, adjustments).
 */
export class Invoice {
  private constructor(private props: InvoiceProps) {}

  static issue(
    input: Omit<
      InvoiceProps,
      | "id"
      | "status"
      | "amountPaid"
      | "amountCredited"
      | "amountWrittenOff"
      | "createdAt"
      | "updatedAt"
      | "lines"
      | "total"
      | "kind"
      | "scheduleId"
      | "installment"
      | "installments"
      | "payer"
      | "payerRef"
    > &
      Partial<
        Pick<InvoiceProps, "scheduleId" | "installment" | "installments" | "payer" | "payerRef">
      > & {
        draft: InvoiceDraft;
        scheduled?: boolean;
      },
    clock: Clock,
  ): Invoice {
    const now = clock.now();
    const { draft, scheduled, ...rest } = input;
    const zero = draft.total.minus(draft.total);

    return new Invoice({
      scheduleId: null,
      installment: 1,
      installments: 1,
      payer: "insured",
      payerRef: null,
      ...rest,
      id: newId<"Invoice">(),
      kind: draft.kind,
      lines: draft.lines,
      total: draft.total,
      amountPaid: zero,
      amountCredited: zero,
      amountWrittenOff: zero,
      status: scheduled ? "scheduled" : "open",
      createdAt: now,
      updatedAt: now,
    });
  }

  static restore(props: InvoiceProps): Invoice {
    return new Invoice(props);
  }

  get id(): InvoiceId {
    return this.props.id;
  }

  get status(): InvoiceStatus {
    return this.props.status;
  }

  get isUnpaid(): boolean {
    return this.props.kind === "invoice" && UNPAID.includes(this.props.status);
  }

  get balance(): Money {
    const p = this.props;

    return p.total.minus(p.amountPaid).minus(p.amountCredited).minus(p.amountWrittenOff);
  }

  get installmentFee(): Money {
    return totalOf(
      this.props.lines.filter((line) => line.kind === "installment_fee"),
      this.props.total.currency,
    );
  }

  /** A scheduled installment becomes a bill on its issue date. */
  open(clock: Clock): boolean {
    if (this.props.status !== "scheduled") return false;

    this.props = { ...this.props, status: "open", updatedAt: clock.now() };
    this.settle(clock);

    return true;
  }

  /** Bills a scheduled installment now, due today (what's still owed after a cancellation). */
  billNow(today: PlainDate, clock: Clock): void {
    if (this.props.status !== "scheduled") return;

    this.props = {
      ...this.props,
      status: "open",
      issuedOn: today,
      dueOn: today,
      updatedAt: clock.now(),
    };
  }

  markPastDue(clock: Clock): boolean {
    if (this.props.status !== "open" && this.props.status !== "partially_paid") return false;

    if (!this.balance.amount.greaterThan(0)) return false;

    this.props = { ...this.props, status: "past_due", updatedAt: clock.now() };

    return true;
  }

  applyPayment(amount: Money, clock: Clock): void {
    this.assertUnpaid();
    this.assertPositive(amount, "Payments");

    if (amount.amount.greaterThan(this.balance.amount)) {
      throw conflict(`The payment is more than the ${this.props.number} balance`);
    }

    this.props = { ...this.props, amountPaid: this.props.amountPaid.plus(amount) };
    this.settle(clock);
  }

  /** A payment returned unpaid (NSF, chargeback): the invoice is owed again. */
  reversePayment(amount: Money, clock: Clock): void {
    this.assertPositive(amount, "Reversals");

    if (amount.amount.greaterThan(this.props.amountPaid.amount)) {
      throw conflict(`The reversal is more than what was paid on ${this.props.number}`);
    }

    this.props = { ...this.props, amountPaid: this.props.amountPaid.minus(amount) };
    this.reopen(clock);
  }

  /** Money paid back against a credit note, or credit drawn from it; `amount` is positive. */
  drawCredit(amount: Money, clock: Clock): void {
    if (this.props.kind !== "credit_note") {
      throw conflict(`${this.props.number} isn't a credit note`);
    }

    this.assertPositive(amount, "Refunds");

    if (amount.amount.greaterThan(this.balance.amount.negated())) {
      throw conflict(`That's more than the ${this.props.number} credit`);
    }

    this.props = { ...this.props, amountPaid: this.props.amountPaid.minus(amount) };

    this.props = {
      ...this.props,
      status: this.balance.isZero() ? "paid" : "partially_paid",
      updatedAt: clock.now(),
    };
  }

  /** Puts credit back on a credit note (a removed credit application). */
  restoreCredit(amount: Money, clock: Clock): void {
    this.assertPositive(amount, "Credits");

    this.props = {
      ...this.props,
      amountPaid: this.props.amountPaid.plus(amount),
      status: "partially_paid",
      updatedAt: clock.now(),
    };
  }

  applyCredit(amount: Money, clock: Clock): void {
    this.assertUnpaid();
    this.assertPositive(amount, "Credits");

    if (amount.amount.greaterThan(this.balance.amount)) {
      throw conflict(`The credit is more than the ${this.props.number} balance`);
    }

    this.props = { ...this.props, amountCredited: this.props.amountCredited.plus(amount) };
    this.settle(clock);
  }

  removeCredit(amount: Money, clock: Clock): void {
    this.assertPositive(amount, "Credits");

    if (amount.amount.greaterThan(this.props.amountCredited.amount)) {
      throw conflict(`That's more credit than ${this.props.number} has`);
    }

    this.props = { ...this.props, amountCredited: this.props.amountCredited.minus(amount) };
    this.reopen(clock);
  }

  writeOff(amount: Money, clock: Clock): void {
    this.assertUnpaid();
    this.assertPositive(amount, "Write-offs");

    if (amount.amount.greaterThan(this.balance.amount)) {
      throw conflict(`The write-off is more than the ${this.props.number} balance`);
    }

    this.props = { ...this.props, amountWrittenOff: this.props.amountWrittenOff.plus(amount) };
    this.settle(clock);
  }

  removeWriteOff(amount: Money, clock: Clock): void {
    this.assertPositive(amount, "Write-offs");

    if (amount.amount.greaterThan(this.props.amountWrittenOff.amount)) {
      throw conflict(`That's more than was written off on ${this.props.number}`);
    }

    this.props = { ...this.props, amountWrittenOff: this.props.amountWrittenOff.minus(amount) };
    this.reopen(clock);
  }

  /** New lines on an unpaid invoice: an endorsement's spread, a waived installment fee. */
  adjust(lines: readonly Charge[], clock: Clock): void {
    this.assertUnpaid();

    const all = [...this.props.lines, ...lines];
    const total = totalOf(all, this.props.total.currency);

    if (total.minus(this.props.amountPaid).isNegative()) {
      throw conflict(`The adjustment takes ${this.props.number} below what was paid`);
    }

    this.props = { ...this.props, lines: all, total };
    this.settle(clock);
  }

  toSnapshot(): Readonly<InvoiceProps> {
    return this.props;
  }

  private settle(clock: Clock): void {
    const p = this.props;
    const now = clock.now();

    if (!this.balance.amount.greaterThan(0)) {
      const neverPaid = p.amountPaid.isZero();

      this.props = {
        ...p,
        status: neverPaid && p.status === "scheduled" ? "void" : "paid",
        updatedAt: now,
      };

      return;
    }

    const status =
      p.status === "scheduled" || p.status === "past_due"
        ? p.status
        : p.amountPaid.isZero()
          ? "open"
          : "partially_paid";

    this.props = { ...p, status, updatedAt: now };
  }

  private reopen(clock: Clock): void {
    if (this.props.status === "paid" || this.props.status === "void") {
      this.props = { ...this.props, status: "open" };
    }

    this.settle(clock);
  }

  private assertUnpaid(): void {
    if (this.props.kind !== "invoice" || !UNPAID.includes(this.props.status)) {
      throw conflict(`${this.props.number} is ${this.props.status.replace("_", " ")}`);
    }
  }

  private assertPositive(amount: Money, noun: string): void {
    if (!amount.amount.greaterThan(0)) throw invalid(`${noun} must be positive`);
  }
}
