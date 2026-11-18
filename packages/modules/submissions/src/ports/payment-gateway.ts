import type { Money, TenantContext } from "@pas/kernel";

/** Raw card fields reach only test providers; real providers take a client-side token instead. */
export type PaymentMethodInput =
  | {
      kind: "card";
      number: string;
      expMonth: number;
      expYear: number;
      cvc: string;
      name: string;
      postalCode?: string;
    }
  | { kind: "token"; token: string };

export interface PaymentMethodSummary {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

export type Authorization =
  | { status: "authorized"; authorizationId: string; method: PaymentMethodSummary }
  | { status: "declined"; code: string; message: string; method: PaymentMethodSummary };

/** Card and bank payments (PLAN §13). Authorize first, capture only once the policy is bound. */
export interface PaymentGateway {
  readonly provider: string;
  authorize(
    ctx: TenantContext,
    input: { reference: string; idempotencyKey: string; amount: Money; method: PaymentMethodInput },
  ): Promise<Authorization>;
  capture(ctx: TenantContext, input: { authorizationId: string; amount: Money }): Promise<void>;
  void(ctx: TenantContext, input: { authorizationId: string }): Promise<void>;
}
