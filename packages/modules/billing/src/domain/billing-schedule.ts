import { type Clock, type Instant, newId, type TenantId } from "@pas/kernel";
import type { Dunning, PayPlan } from "@pas/pay-plans";

export type BillingMethod = "direct" | "agency" | "mortgagee";

export interface BillingScheduleProps {
  id: string;
  tenantId: TenantId;
  policyId: string;
  policyNumber: string;
  termId: string;
  billingMethod: BillingMethod;
  plan: PayPlan;
  dunning: Dunning;
  status: "active" | "closed";
  paymentMethodId: string | null;
  createdAt: Instant;
  updatedAt: Instant;
}

export interface SavedPaymentMethod {
  id: string;
  policyId: string;
  provider: string;
  providerRef: string;
  customerRef: string | null;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  consent: { text: string; acceptedAt: string; by: string };
  status: "active" | "removed";
  createdAt: Instant;
  updatedAt: Instant;
}

/** One term's installments under its pay plan, and the card autopay charges them to. */
export class BillingSchedule {
  private constructor(private props: BillingScheduleProps) {}

  static start(
    input: Omit<
      BillingScheduleProps,
      "id" | "status" | "paymentMethodId" | "createdAt" | "updatedAt"
    >,
    clock: Clock,
  ): BillingSchedule {
    const now = clock.now();

    return new BillingSchedule({
      ...input,
      id: newId(),
      status: "active",
      paymentMethodId: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  static restore(props: BillingScheduleProps): BillingSchedule {
    return new BillingSchedule(props);
  }

  get id(): string {
    return this.props.id;
  }

  get isActive(): boolean {
    return this.props.status === "active";
  }

  get autopayMethodId(): string | null {
    return this.props.paymentMethodId;
  }

  useForAutopay(paymentMethodId: string | null, clock: Clock): void {
    this.props = { ...this.props, paymentMethodId, updatedAt: clock.now() };
  }

  close(clock: Clock): void {
    this.props = { ...this.props, status: "closed", updatedAt: clock.now() };
  }

  toSnapshot(): Readonly<BillingScheduleProps> {
    return this.props;
  }
}
