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
import type { Charge, InvoiceDraft } from "./invoice-lines";

export type InvoiceId = Id<"Invoice">;
export type InvoiceStatus = "open" | "partially_paid" | "paid" | "void";

export interface InvoiceProps {
  id: InvoiceId;
  tenantId: TenantId;
  number: string;
  kind: InvoiceDraft["kind"];
  policyId: string;
  policyNumber: string;
  transactionId: string;
  lines: Charge[];
  total: Money;
  amountPaid: Money;
  status: InvoiceStatus;
  issuedOn: PlainDate;
  dueOn: PlainDate;
  createdAt: Instant;
  updatedAt: Instant;
}

export interface PaymentProps {
  id: string;
  policyId: string;
  invoiceId: InvoiceId;
  provider: string;
  providerRef: string;
  method: Record<string, unknown>;
  amount: Money;
  receivedAt: Instant;
}

/** One bill for one financial transaction; payments move it from open to paid. */
export class Invoice {
  private constructor(private props: InvoiceProps) {}

  static issue(
    input: Omit<
      InvoiceProps,
      "id" | "status" | "amountPaid" | "createdAt" | "updatedAt" | "lines" | "total" | "kind"
    > & {
      draft: InvoiceDraft;
    },
    clock: Clock,
  ): Invoice {
    const now = clock.now();
    const { draft, ...rest } = input;

    return new Invoice({
      ...rest,
      id: newId<"Invoice">(),
      kind: draft.kind,
      lines: draft.lines,
      total: draft.total,
      amountPaid: draft.total.minus(draft.total),
      status: "open",
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

  get balance(): Money {
    return this.props.total.minus(this.props.amountPaid);
  }

  applyPayment(amount: Money, clock: Clock): void {
    if (this.props.status === "void" || this.props.status === "paid") {
      throw conflict(`${this.props.number} is ${this.props.status.replace("_", " ")}`);
    }

    if (!amount.amount.isPositive()) throw invalid("Payments must be positive");

    if (amount.amount.greaterThan(this.balance.amount)) {
      throw conflict(`The payment is more than the ${this.props.number} balance`);
    }

    const amountPaid = this.props.amountPaid.plus(amount);

    this.props = {
      ...this.props,
      amountPaid,
      status: amountPaid.equals(this.props.total) ? "paid" : "partially_paid",
      updatedAt: clock.now(),
    };
  }

  toSnapshot(): Readonly<InvoiceProps> {
    return this.props;
  }
}
