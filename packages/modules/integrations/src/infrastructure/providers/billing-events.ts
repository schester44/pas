import { z } from "zod";
import type { BillingSystem } from "../../ports/adapters";
import type { ProviderPackage, ProviderSettings, WebhookEvent } from "../../ports/provider-catalog";
import { failure, signPayload, verifySignature } from "./signing";

const configSchema = z.object({
  url: z
    .url()
    .optional()
    .meta({ title: "Outbound URL", description: "We POST signed billing events here (optional)." }),
});

const money = z.object({
  amount: z.string().regex(/^-?\d+(\.\d+)?$/),
  currency: z.string().length(3),
});

/** The canonical inbound billing event (PLAN §13 "Bring your own billing"). */
export const inboundBillingEvent = z
  .object({
    id: z.string().min(1).max(200),
    type: z.enum([
      "payment.received",
      "payment.failed",
      "payment.reversed",
      "refund.issued",
      "credit.applied",
      "credit.removed",
      "writeoff.applied",
      "writeoff.removed",
      "invoice.adjusted",
      "account.delinquent",
      "account.current",
      "payment_method.updated",
    ]),
    occurredAt: z.iso.datetime({ offset: true }),
    invoiceId: z.uuid().optional(),
    policyNumber: z.string().max(60).optional(),
    amount: money.optional(),
    reference: z.string().max(200).optional(),
    method: z
      .object({ brand: z.string().max(40).optional(), last4: z.string().max(4).optional() })
      .optional(),
    creditNoteId: z.uuid().optional(),
    lines: z
      .array(z.object({ code: z.string().max(60), label: z.string().max(200), amount: money }))
      .max(50)
      .optional(),
    reason: z.string().max(500).optional(),
  })
  .refine((e) => e.invoiceId || e.policyNumber, { message: "Name an invoiceId or a policyNumber" });

class SignedBillingSystem implements BillingSystem {
  constructor(
    private readonly settings: ProviderSettings,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async publish(type: string, data: Record<string, unknown>): Promise<void> {
    const { url } = configSchema.parse(this.settings.config);

    if (!url) return;

    const body = JSON.stringify({ type, data });

    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-pas-signature": signPayload(this.settings.secrets.signingSecret ?? "", body),
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) throw await failure(response);
  }
}

/**
 * An external billing platform that owns money movement and posts canonical billing events to
 * `POST /api/billing/events/:installId`, signed with the install's secret.
 */
export function externalBillingProvider(
  fetchImpl: typeof fetch = fetch,
): ProviderPackage<"billing"> {
  return {
    manifest: {
      id: "external_billing",
      name: "External billing system",
      vendor: "Your billing platform",
      category: "billing",
      summary: "Your billing platform moves the money and posts signed billing events back.",
      description:
        "PAS keeps invoices and the policy consequences. Your billing system posts payments, failures, reversals, refunds, credits, write-offs, adjustments and delinquency to the billing events endpoint, signed with HMAC-SHA256; each is applied exactly like PAS's own billing.",
      capabilities: [
        "Signed inbound billing events",
        "Idempotent by event id",
        "Delinquency source",
      ],
      configSchema,
      secrets: [
        {
          key: "signingSecret",
          label: "Signing secret",
          description: "A long random string shared with your billing system.",
        },
      ],
      docsUrl: null,
      logo: { icon: "webhook" },
      testMode: true,
      liveMode: true,
      certified: false,
      builtin: false,
      webhook: { kind: "billing_events", events: ["billing events"] },
    },
    create: (settings) => new SignedBillingSystem(settings, fetchImpl),
    check: async (settings) =>
      settings.secrets.signingSecret
        ? { ok: true, detail: "Ready to receive signed billing events" }
        : { ok: false, detail: "Add the signing secret" },
    async webhook(request, settings): Promise<WebhookEvent[]> {
      verifySignature(
        settings.secrets.signingSecret ?? "",
        request.rawBody,
        request.headers.get("x-pas-signature"),
      );

      const raw = JSON.parse(request.rawBody) as unknown;

      const events = z
        .array(inboundBillingEvent)
        .max(500)
        .parse(Array.isArray(raw) ? raw : [raw]);

      return events
        .toSorted((a, b) => a.occurredAt.localeCompare(b.occurredAt))
        .map((event) => ({
          kind: "billing" as const,
          externalId: event.id,
          summary: `${event.type}${event.invoiceId ? ` for invoice ${event.invoiceId}` : ` for ${event.policyNumber}`}`,
          data: event,
        }));
    },
  };
}
