import {
  AggregateRoot,
  type Clock,
  conflict,
  type Instant,
  newId,
  type PlainDate,
  type TenantId,
} from "@pas/kernel";
import type { MortgageeFollowUp } from "@pas/pay-plans";
import type { PayerAddress } from "./invoice";

export interface Lender {
  name: string;
  loanNumber: string | null;
  address: PayerAddress | null;
  email: string | null;
}

export type MortgageeBillStatus =
  | "awaiting_packet"
  | "awaiting_payment"
  | "paid"
  | "switched_to_direct"
  | "nonpayment";

export type MortgageeHistoryKind =
  | "packet_sent"
  | "reminder_sent"
  | "insured_offered_direct"
  | "switched_to_direct"
  | "nonpayment_started"
  | "paid"
  | "lender_changed";

export interface MortgageeHistoryEntry {
  kind: MortgageeHistoryKind;
  on: string;
  summary: string;
}

export interface MortgageeBillProps {
  id: string;
  tenantId: TenantId;
  policyId: string;
  policyNumber: string;
  termId: string;
  invoiceId: string;
  lender: Lender;
  followUp: MortgageeFollowUp;
  status: MortgageeBillStatus;
  sentOn: PlainDate | null;
  history: MortgageeHistoryEntry[];
  createdAt: Instant;
  updatedAt: Instant;
}

const OPEN: readonly MortgageeBillStatus[] = ["awaiting_packet", "awaiting_payment"];

/**
 * A term billed to its lender (PLAN §13): the invoice packet goes to the lender, follow-ups run
 * from the day it was sent, and the insured can take the bill over (direct bill).
 */
export class MortgageeBill extends AggregateRoot {
  private constructor(private props: MortgageeBillProps) {
    super();
  }

  static start(
    input: Omit<
      MortgageeBillProps,
      "id" | "status" | "sentOn" | "history" | "createdAt" | "updatedAt"
    >,
    clock: Clock,
  ): MortgageeBill {
    const now = clock.now();

    const bill = new MortgageeBill({
      ...input,
      id: newId(),
      status: "awaiting_packet",
      sentOn: null,
      history: [],
      createdAt: now,
      updatedAt: now,
    });

    bill.emit("billing.mortgagee_bill_started", now);

    return bill;
  }

  static restore(props: MortgageeBillProps): MortgageeBill {
    return new MortgageeBill(props);
  }

  get id(): string {
    return this.props.id;
  }

  get status(): MortgageeBillStatus {
    return this.props.status;
  }

  get isOpen(): boolean {
    return OPEN.includes(this.props.status);
  }

  /** The lender still owes it: neither paid nor taken over by the insured. */
  get lenderPays(): boolean {
    return this.isOpen;
  }

  packetSent(on: PlainDate, summary: string, clock: Clock): void {
    if (this.props.status !== "awaiting_packet") {
      this.note("packet_sent", on, summary, clock);

      return;
    }

    this.props = { ...this.props, status: "awaiting_payment", sentOn: on };
    this.note("packet_sent", on, summary, clock);
  }

  note(kind: MortgageeHistoryKind, on: PlainDate, summary: string, clock: Clock): void {
    this.props = {
      ...this.props,
      history: [...this.props.history, { kind, on: on.toString(), summary }],
      updatedAt: clock.now(),
    };
  }

  markPaid(on: PlainDate, clock: Clock): boolean {
    if (!this.isOpen) return false;

    this.props = { ...this.props, status: "paid" };
    this.note("paid", on, `Paid by ${this.props.lender.name}`, clock);

    return true;
  }

  switchToDirect(on: PlainDate, by: string, clock: Clock): void {
    if (!this.isOpen) {
      throw conflict(`The lender's bill is already ${this.props.status.replaceAll("_", " ")}`);
    }

    this.props = { ...this.props, status: "switched_to_direct" };
    this.note("switched_to_direct", on, `Switched to direct bill by ${by}`, clock);
    this.emit("billing.mortgagee_switched_to_direct", clock.now());
  }

  startNonpayment(on: PlainDate, clock: Clock): void {
    if (this.props.status === "switched_to_direct") {
      this.note(
        "nonpayment_started",
        on,
        "The insured didn't pay after switching to direct bill",
        clock,
      );

      return;
    }

    this.props = { ...this.props, status: "nonpayment" };

    this.note(
      "nonpayment_started",
      on,
      "Unpaid: nonpayment notices to the insured and mortgagee",
      clock,
    );
  }

  changeLender(lender: Lender, on: PlainDate, clock: Clock): boolean {
    const same =
      lender.name === this.props.lender.name &&
      (lender.loanNumber ?? null) === (this.props.lender.loanNumber ?? null);

    if (same || !this.isOpen) return false;

    this.props = { ...this.props, lender, status: "awaiting_packet" };
    this.note("lender_changed", on, `Lender changed to ${lender.name}`, clock);
    this.emit("billing.mortgagee_bill_started", clock.now());

    return true;
  }

  toSnapshot(): Readonly<MortgageeBillProps> {
    return this.props;
  }

  private emit(type: string, at: Instant): void {
    this.record({
      id: newId(),
      type,
      tenantId: this.props.tenantId,
      aggregateType: "mortgagee_bill",
      aggregateId: this.props.id,
      occurredAt: at,
      payload: {
        mortgageeBillId: this.props.id,
        policyId: this.props.policyId,
        invoiceId: this.props.invoiceId,
      },
    });
  }
}
