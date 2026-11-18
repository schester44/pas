import {
  type ClockProvider,
  DomainError,
  type Money,
  newId,
  type TenantContext,
} from "@pas/kernel";
import type {
  Authorization,
  PaymentGateway,
  PaymentMethodInput,
  PaymentMethodSummary,
} from "../ports/payment-gateway";

const APPROVED = new Set(["4242424242424242", "5555555555554444"]);

const DECLINED: Record<string, { code: string; message: string }> = {
  "4000000000000002": { code: "card_declined", message: "The card was declined." },
  "4000000000009995": {
    code: "insufficient_funds",
    message: "The card has insufficient funds.",
  },
};

interface Held {
  id: string;
  amount: Money;
  status: "authorized" | "captured" | "voided";
  method: PaymentMethodSummary;
}

const brandOf = (number: string) =>
  number.startsWith("4") ? "Visa" : /^5[1-5]/.test(number) ? "Mastercard" : "Card";

/** Test card provider: 4242 4242 4242 4242 succeeds, 4000 0000 0000 0002 declines. */
export class FakeCardGateway implements PaymentGateway {
  readonly provider = "test_card";
  private readonly byKey = new Map<string, Held>();
  private readonly byId = new Map<string, Held>();
  private readonly refunds = new Map<string, string>();

  constructor(private readonly clocks: ClockProvider) {}

  async authorize(
    ctx: TenantContext,
    input: { reference: string; idempotencyKey: string; amount: Money; method: PaymentMethodInput },
  ): Promise<Authorization> {
    if (input.method.kind !== "card") {
      throw new DomainError("invalid", "The test provider only takes card numbers");
    }

    const card = input.method;
    const number = card.number.replace(/\D/g, "");

    const method: PaymentMethodSummary = {
      brand: brandOf(number),
      last4: number.slice(-4),
      expMonth: card.expMonth,
      expYear: card.expYear,
    };

    const existing = this.byKey.get(input.idempotencyKey);

    if (existing && existing.status !== "voided" && existing.method.last4 === method.last4) {
      return { status: "authorized", authorizationId: existing.id, method: existing.method };
    }

    const declined = this.decline(ctx, number, card.expMonth, card.expYear);

    if (declined) return { status: "declined", ...declined, method };

    const held: Held = {
      id: `auth_${newId()}`,
      amount: input.amount,
      status: "authorized",
      method,
    };

    this.byKey.set(input.idempotencyKey, held);
    this.byId.set(held.id, held);

    return { status: "authorized", authorizationId: held.id, method };
  }

  async capture(_ctx: TenantContext, input: { authorizationId: string; amount: Money }) {
    const held = this.byId.get(input.authorizationId);

    if (!held || held.status === "voided") {
      throw new DomainError("conflict", "That payment authorization is no longer valid");
    }

    if (!held.amount.equals(input.amount)) {
      throw new DomainError("conflict", "The capture amount doesn't match the authorization");
    }

    held.status = "captured";
  }

  async void(_ctx: TenantContext, input: { authorizationId: string }) {
    const held = this.byId.get(input.authorizationId);

    if (held && held.status === "authorized") held.status = "voided";
  }

  async refund(
    _ctx: TenantContext,
    input: { paymentRef: string; amount: Money; idempotencyKey: string },
  ): Promise<{ refundId: string }> {
    if (!input.amount.amount.isPositive())
      throw new DomainError("invalid", "Refunds must be positive");

    const existing = this.refunds.get(input.idempotencyKey);

    if (existing) return { refundId: existing };

    const refundId = `re_${newId()}`;
    this.refunds.set(input.idempotencyKey, refundId);

    return { refundId };
  }

  private decline(ctx: TenantContext, number: string, expMonth: number, expYear: number) {
    const today = this.clocks.forTenant(ctx.tenantId).today("UTC");

    if (expYear < today.year || (expYear === today.year && expMonth < today.month)) {
      return { code: "expired_card", message: "The card has expired." };
    }

    if (DECLINED[number]) return DECLINED[number];

    if (!APPROVED.has(number)) {
      return {
        code: "test_card_required",
        message: "Use a test card, such as 4242 4242 4242 4242.",
      };
    }

    return null;
  }
}
