import {
  type Clock,
  conflict,
  type Instant,
  invalid,
  type Money,
  newId,
  type PlainDate,
  type TenantId,
} from "@pas/kernel";
import type { Rail } from "./accounts";
import type { Payer } from "./posting-rules";

export type PaymentStatus = "unapplied" | "partially_applied" | "applied" | "reversed";

export interface ApplicationProps {
  id: string;
  invoiceId: string;
  policyId: string;
  statementId: string | null;
  amount: Money;
  status: "active" | "reversed";
  eventId: string;
  appliedAt: Instant;
  reversedAt: Instant | null;
}

export interface PaymentProps {
  id: string;
  tenantId: TenantId;
  number: string;
  rail: Rail;
  payer: Payer | null;
  amount: Money;
  applied: Money;
  refunded: Money;
  receivedOn: PlainDate;
  reference: string | null;
  provider: string | null;
  providerRef: string | null;
  batchId: string | null;
  status: PaymentStatus;
  reversalReason: string | null;
  reversedAt: Instant | null;
  memo: string | null;
  version: number;
  applications: ApplicationProps[];
  createdAt: Instant;
  updatedAt: Instant;
}

export type NewPayment = Pick<
  PaymentProps,
  | "tenantId"
  | "number"
  | "rail"
  | "payer"
  | "amount"
  | "receivedOn"
  | "reference"
  | "provider"
  | "providerRef"
  | "batchId"
  | "memo"
>;

const positive = (amount: Money, noun: string) => {
  if (!amount.amount.greaterThan(0)) throw invalid(`${noun} must be more than zero`);
};

/**
 * Money received from a payer. It starts as unapplied cash and is applied to invoices; what's
 * left stays unapplied until it's applied or refunded. A returned payment (NSF, chargeback)
 * reverses every application and the receipt itself.
 */
export class Payment {
  private constructor(private props: PaymentProps) {}

  static receive(input: NewPayment, clock: Clock): Payment {
    positive(input.amount, "A payment");

    const now = clock.now();
    const zero = input.amount.minus(input.amount);

    return new Payment({
      ...input,
      id: newId(),
      applied: zero,
      refunded: zero,
      status: "unapplied",
      reversalReason: null,
      reversedAt: null,
      version: 0,
      applications: [],
      createdAt: now,
      updatedAt: now,
    });
  }

  static restore(props: PaymentProps): Payment {
    return new Payment(props);
  }

  get id(): string {
    return this.props.id;
  }

  get payer(): Payer | null {
    return this.props.payer;
  }

  get rail(): Rail {
    return this.props.rail;
  }

  get unapplied(): Money {
    return this.props.amount.minus(this.props.applied).minus(this.props.refunded);
  }

  get activeApplications(): readonly ApplicationProps[] {
    return this.props.applications.filter((a) => a.status === "active");
  }

  get isReversed(): boolean {
    return this.props.status === "reversed";
  }

  /** A lockbox item held in suspense gets its payer once someone identifies it. */
  identify(payer: Payer, clock: Clock): void {
    this.props = { ...this.props, payer, updatedAt: clock.now() };
  }

  apply(
    input: { invoiceId: string; policyId: string; amount: Money; statementId?: string | null },
    eventId: string,
    clock: Clock,
  ): ApplicationProps {
    this.assertLive();
    positive(input.amount, "An application");

    if (input.amount.amount.greaterThan(this.unapplied.amount)) {
      throw conflict(
        `${this.props.number} has ${this.unapplied.toString()} unapplied, less than ${input.amount.toString()}`,
      );
    }

    const application: ApplicationProps = {
      id: newId(),
      invoiceId: input.invoiceId,
      policyId: input.policyId,
      statementId: input.statementId ?? null,
      amount: input.amount,
      status: "active",
      eventId,
      appliedAt: clock.now(),
      reversedAt: null,
    };

    this.props = {
      ...this.props,
      applied: this.props.applied.plus(input.amount),
      applications: [...this.props.applications, application],
    };

    this.settle(clock);

    return application;
  }

  unapply(applicationId: string, clock: Clock): ApplicationProps {
    this.assertLive();

    const application = this.activeApplications.find((a) => a.id === applicationId);

    if (!application) throw conflict("That application isn't active on this payment");

    this.markReversed([application.id], clock);
    this.settle(clock);

    return application;
  }

  /** Returned unpaid (NSF, chargeback, stop payment): every application comes off first. */
  reverse(reason: string, clock: Clock): readonly ApplicationProps[] {
    this.assertLive();

    if (!this.props.refunded.isZero()) {
      throw conflict(`${this.props.number} was partly refunded; reverse the refund first`);
    }

    const active = this.activeApplications;

    this.markReversed(
      active.map((a) => a.id),
      clock,
    );

    this.props = {
      ...this.props,
      status: "reversed",
      reversalReason: reason,
      reversedAt: clock.now(),
      updatedAt: clock.now(),
    };

    return active;
  }

  refund(amount: Money, clock: Clock): void {
    this.assertLive();
    positive(amount, "A refund");

    if (amount.amount.greaterThan(this.unapplied.amount)) {
      throw conflict(`Only ${this.unapplied.toString()} of ${this.props.number} is unapplied`);
    }

    this.props = { ...this.props, refunded: this.props.refunded.plus(amount) };
    this.settle(clock);
  }

  /** The version the repository stored, for the next optimistic save. */
  stored(version: number): void {
    this.props = { ...this.props, version };
  }

  toSnapshot(): Readonly<PaymentProps> {
    return this.props;
  }

  private markReversed(ids: readonly string[], clock: Clock): void {
    const now = clock.now();
    let applied = this.props.applied;

    const applications = this.props.applications.map((a) => {
      if (!ids.includes(a.id)) return a;

      applied = applied.minus(a.amount);

      return { ...a, status: "reversed" as const, reversedAt: now };
    });

    this.props = { ...this.props, applications, applied, updatedAt: now };
  }

  private settle(clock: Clock): void {
    const status: PaymentStatus = this.unapplied.isZero()
      ? "applied"
      : this.props.applied.isZero()
        ? "unapplied"
        : "partially_applied";

    this.props = { ...this.props, status, updatedAt: clock.now() };
  }

  private assertLive(): void {
    if (this.isReversed) throw conflict(`${this.props.number} was reversed`);
  }
}
