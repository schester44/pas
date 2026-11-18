import { DomainError, type Money } from "@pas/kernel";
import { Stripe } from "stripe";
import { z } from "zod";
import type {
  Authorization,
  CardPayments,
  PaymentMethodInput,
  PaymentMethodSummary,
} from "../../ports/adapters";
import type { ProviderPackage, ProviderSettings, WebhookEvent } from "../../ports/provider-catalog";

const configSchema = z.object({
  publishableKey: z
    .string()
    .regex(/^pk_(test|live)_\w+$/, "Starts with pk_test_ or pk_live_")
    .meta({ title: "Publishable key", description: "Used by Stripe Elements in the browser." }),
  statementDescriptorSuffix: z
    .string()
    .max(22)
    .optional()
    .meta({ title: "Statement descriptor suffix", description: "Shown on the payer's statement." }),
});

type StripeConfig = z.infer<typeof configSchema>;

// Stripe's test mode refuses raw card numbers; these are its documented test payment methods.
const TEST_CARDS: Record<string, string> = {
  "4242424242424242": "pm_card_visa",
  "5555555555554444": "pm_card_mastercard",
  "4000000000000002": "pm_card_chargeDeclined",
  "4000000000009995": "pm_card_chargeDeclinedInsufficientFunds",
};

const PAYMENT_EVENTS = [
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
  "charge.refunded",
  "charge.dispute.created",
];

export function minorUnits(money: Money): number {
  const digits =
    new Intl.NumberFormat("en", { style: "currency", currency: money.currency }).resolvedOptions()
      .maximumFractionDigits ?? 2;

  const minor = money.amount.times(10 ** digits);

  if (!minor.isInteger())
    throw new Error(`${money.toString()} has more precision than ${money.currency}`);

  return minor.toNumber();
}

const keyMode = (key: string) => (/^(sk|rk|pk)_live_/.test(key) ? "live" : "test");

export function stripeClient(secretKey: string, options: Stripe.StripeConfig = {}): Stripe {
  return new Stripe(secretKey, {
    maxNetworkRetries: 2,
    appInfo: { name: "PAS" },
    ...options,
  });
}

export class StripePayments implements CardPayments {
  readonly provider = "stripe";
  readonly checkout;

  constructor(
    private readonly stripe: Stripe,
    private readonly config: StripeConfig,
    private readonly testMode: boolean,
  ) {
    this.checkout = { kind: "stripe" as const, publishableKey: config.publishableKey, testMode };
  }

  async authorize(
    ctx: { tenantId: string },
    input: { reference: string; idempotencyKey: string; amount: Money; method: PaymentMethodInput },
  ): Promise<Authorization> {
    const paymentMethod = this.paymentMethodOf(input.method);

    if (!paymentMethod) {
      return {
        status: "declined",
        code: "test_card_required",
        message: "Use a test card, such as 4242 4242 4242 4242.",
        method: summaryOfInput(input.method),
      };
    }

    try {
      const intent = await this.stripe.paymentIntents.create(
        {
          amount: minorUnits(input.amount),
          currency: input.amount.currency.toLowerCase(),
          payment_method: paymentMethod,
          confirm: true,
          capture_method: "manual",
          description: input.reference,
          metadata: { reference: input.reference, tenantId: ctx.tenantId },
          automatic_payment_methods: { enabled: true, allow_redirects: "never" },
          expand: ["payment_method"],
          ...(this.config.statementDescriptorSuffix && {
            statement_descriptor_suffix: this.config.statementDescriptorSuffix,
          }),
        },
        { idempotencyKey: `authorize:${input.idempotencyKey}:${paymentMethod}` },
      );

      const method = summaryOf(intent.payment_method, input.method);

      if (intent.status === "requires_capture") {
        return { status: "authorized", authorizationId: intent.id, method };
      }

      await this.stripe.paymentIntents.cancel(intent.id).catch(() => undefined);

      return {
        status: "declined",
        code: intent.status === "requires_action" ? "authentication_required" : intent.status,
        message:
          intent.status === "requires_action"
            ? "This card needs the cardholder to authenticate. Try another card."
            : "The card wasn't authorized.",
        method,
      };
    } catch (error) {
      if (error instanceof Stripe.errors.StripeCardError) {
        return {
          status: "declined",
          code: error.decline_code ?? error.code ?? "card_declined",
          message: error.message,
          method: summaryOf(error.payment_method ?? null, input.method),
        };
      }

      throw error;
    }
  }

  async capture(_ctx: unknown, input: { authorizationId: string; amount: Money }): Promise<void> {
    await this.stripe.paymentIntents.capture(
      input.authorizationId,
      { amount_to_capture: minorUnits(input.amount) },
      { idempotencyKey: `capture:${input.authorizationId}` },
    );
  }

  async void(_ctx: unknown, input: { authorizationId: string }): Promise<void> {
    await this.stripe.paymentIntents.cancel(input.authorizationId);
  }

  async refund(
    _ctx: unknown,
    input: { paymentRef: string; amount: Money; idempotencyKey: string },
  ): Promise<{ refundId: string }> {
    if (!input.amount.amount.isPositive())
      throw new DomainError("invalid", "Refunds must be positive");

    const refund = await this.stripe.refunds.create(
      { payment_intent: input.paymentRef, amount: minorUnits(input.amount) },
      { idempotencyKey: input.idempotencyKey },
    );

    return { refundId: refund.id };
  }

  private paymentMethodOf(method: PaymentMethodInput): string | null {
    if (method.kind === "token") return method.token;

    if (!this.testMode) {
      throw new DomainError("invalid", "Enter the card in the secure card form");
    }

    return TEST_CARDS[method.number.replace(/\D/g, "")] ?? null;
  }
}

function summaryOfInput(method: PaymentMethodInput): PaymentMethodSummary {
  if (method.kind === "token") return { brand: "Card", last4: "", expMonth: 0, expYear: 0 };

  const number = method.number.replace(/\D/g, "");

  return {
    brand: number.startsWith("4") ? "Visa" : "Card",
    last4: number.slice(-4),
    expMonth: method.expMonth,
    expYear: method.expYear,
  };
}

function summaryOf(
  paymentMethod: string | Stripe.PaymentMethod | null,
  input: PaymentMethodInput,
): PaymentMethodSummary {
  const card = typeof paymentMethod === "object" ? paymentMethod?.card : undefined;

  if (!card) return summaryOfInput(input);

  return {
    brand: card.brand.charAt(0).toUpperCase() + card.brand.slice(1),
    last4: card.last4,
    expMonth: card.exp_month,
    expYear: card.exp_year,
  };
}

function settingsOf(settings: ProviderSettings) {
  const config = configSchema.parse(settings.config);
  const secretKey = settings.secrets.secretKey ?? "";

  return { config, secretKey };
}

export const stripeProvider: ProviderPackage<"payments"> = {
  manifest: {
    id: "stripe",
    name: "Stripe",
    vendor: "Stripe",
    category: "payments",
    summary: "Card payments through Stripe, with the card entered in Stripe Elements.",
    description:
      "Authorizes the premium when the payer submits, captures it once the policy is issued, and voids it if issuing fails. Refunds for cancellations go back to the same card. Card details never touch your servers.",
    capabilities: [
      "Authorize and capture",
      "Void on failed issue",
      "Refunds",
      "Stripe Elements card form",
      "Signed webhooks",
    ],
    configSchema,
    secrets: [
      {
        key: "secretKey",
        label: "Secret key",
        description: "sk_test_… or sk_live_…, or a restricted key.",
      },
      {
        key: "webhookSecret",
        label: "Webhook signing secret",
        description: "whsec_… from the endpoint you add in Stripe.",
        optional: true,
      },
    ],
    docsUrl: "https://docs.stripe.com/payments/place-a-hold-on-a-payment-method",
    logo: { mark: "S" },
    testMode: true,
    liveMode: true,
    certified: true,
    builtin: false,
    webhook: { kind: "stripe", events: PAYMENT_EVENTS },
  },

  create(settings) {
    const { config, secretKey } = settingsOf(settings);

    return new StripePayments(stripeClient(secretKey), config, settings.environment === "test");
  },

  async check(settings) {
    const { config, secretKey } = settingsOf(settings);

    if (!secretKey) return { ok: false, detail: "Add the secret key" };

    for (const [label, key] of [
      ["secret key", secretKey],
      ["publishable key", config.publishableKey],
    ] as const) {
      if (keyMode(key) !== settings.environment) {
        return {
          ok: false,
          detail: `The ${label} is a ${keyMode(key)} key; this install is in ${settings.environment} mode`,
        };
      }
    }

    const account = await stripeClient(secretKey, {
      maxNetworkRetries: 0,
    }).accounts.retrieveCurrent();

    const name =
      account.settings?.dashboard.display_name ?? account.business_profile?.name ?? account.id;

    return { ok: true, detail: `${name} (${account.id}), ${settings.environment} mode` };
  },

  async webhook(request, settings) {
    const secret = settings.secrets.webhookSecret;

    if (!secret) throw new Error("no webhook signing secret is set");

    const event = await Stripe.webhooks.constructEventAsync(
      request.rawBody,
      request.headers.get("stripe-signature") ?? "",
      secret,
    );

    return [paymentEvent(event)];
  },
};

function paymentEvent(event: Stripe.Event): WebhookEvent {
  const object = event.data.object as {
    id?: string;
    object?: string;
    payment_intent?: string | null;
    amount?: number;
    currency?: string;
  };

  const paymentRef =
    object.object === "payment_intent" ? (object.id ?? null) : (object.payment_intent ?? null);

  return {
    kind: "payment",
    externalId: event.id,
    type: event.type,
    paymentRef,
    summary: `${event.type}${paymentRef ? ` for ${paymentRef}` : ""}`,
    data: {
      livemode: event.livemode,
      object: object.object,
      amount: object.amount,
      currency: object.currency,
    },
  };
}
