import type { Money, TenantContext } from "@pas/kernel";

export type CardMethod = {
  kind: "card";
  number: string;
  expMonth: number;
  expYear: number;
  cvc: string;
  name: string;
  postalCode?: string;
};

export interface CardSummary {
  brand: string;
  last4: string;
}

/** The card provider (PLAN §13), the same one quoting pays through at bind. */
export interface PaymentGateway {
  readonly provider: string;
  authorize(
    ctx: TenantContext,
    input: { reference: string; idempotencyKey: string; amount: Money; method: CardMethod },
  ): Promise<
    | { status: "authorized"; authorizationId: string; method: CardSummary }
    | { status: "declined"; code: string; message: string; method: CardSummary }
  >;
  capture(ctx: TenantContext, input: { authorizationId: string; amount: Money }): Promise<void>;
  void(ctx: TenantContext, input: { authorizationId: string }): Promise<void>;
  /** Refunds part or all of a captured payment; idempotent on the key. */
  refund(
    ctx: TenantContext,
    input: { paymentRef: string; amount: Money; idempotencyKey: string },
  ): Promise<{ refundId: string }>;
}
