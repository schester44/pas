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

export type PaymentMethodInput = CardMethod | { kind: "token"; token: string };

export interface CardSummary {
  brand: string;
  last4: string;
  expMonth?: number;
  expYear?: number;
}

export type SaveResult =
  | {
      status: "saved";
      methodRef: string;
      customerRef: string | null;
      method: CardSummary & { expMonth: number; expYear: number };
    }
  | { status: "declined"; code: string; message: string; method: CardSummary };

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
  /** Saves a card for later off-session charges, with the payer's consent. */
  saveMethod(
    ctx: TenantContext,
    input: {
      reference: string;
      method: PaymentMethodInput;
      customer: { name: string; email?: string };
    },
  ): Promise<SaveResult>;
  /** Charges a saved card off-session (autopay); idempotent on the key. */
  chargeSaved(
    ctx: TenantContext,
    input: {
      reference: string;
      idempotencyKey: string;
      amount: Money;
      methodRef: string;
      customerRef: string | null;
    },
  ): Promise<
    | { status: "paid"; paymentRef: string; method: CardSummary }
    | { status: "declined"; code: string; message: string; method: CardSummary }
  >;
}
