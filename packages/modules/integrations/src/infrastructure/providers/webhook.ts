import { newId } from "@pas/kernel";
import { z } from "zod";
import type { EmailMessage, EmailSender, LetterRequest, PrintMail } from "../../ports/adapters";
import type {
  HealthResult,
  InboundWebhook,
  ProviderPackage,
  ProviderSettings,
  WebhookEvent,
} from "../../ports/provider-catalog";
import { failure, signPayload, verifySignature } from "./signing";

const configSchema = z.object({
  url: z.url().meta({ title: "Endpoint URL", description: "We POST a signed JSON payload here." }),
});

const SECRETS = [
  {
    key: "signingSecret",
    label: "Signing secret",
    description: "A long random string. We sign requests with it and check it on status callbacks.",
  },
];

/** POSTs `{ id, type, environment, createdAt, data }` with an `X-PAS-Signature` HMAC header. */
export function signedRequest(settings: ProviderSettings, type: string, data: unknown): Request {
  const { url } = configSchema.parse(settings.config);

  const body = JSON.stringify({
    id: `evt_${newId()}`,
    type,
    environment: settings.environment,
    createdAt: new Date().toISOString(),
    data,
  });

  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "PAS-Webhooks/1",
      "x-pas-signature": signPayload(settings.secrets.signingSecret ?? "", body),
      ...(settings.webhookUrl && { "x-pas-callback-url": settings.webhookUrl }),
    },
    body,
  });
}

async function post(fetchImpl: typeof fetch, request: Request): Promise<Record<string, unknown>> {
  const response = await fetchImpl(request, { signal: AbortSignal.timeout(10_000) });

  if (!response.ok) throw await failure(response);

  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

async function ping(fetchImpl: typeof fetch, settings: ProviderSettings): Promise<HealthResult> {
  await post(fetchImpl, signedRequest(settings, "ping", {}));

  return {
    ok: true,
    detail: `${new URL(configSchema.parse(settings.config).url).host} answered the signed ping`,
  };
}

const callbackSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["letter.status", "email.status"]),
  data: z.object({
    providerRef: z.string().min(1),
    status: z.string().min(1),
    trackingNumber: z.string().nullish(),
    occurredAt: z.iso.datetime({ offset: true }).optional(),
    proofOfMailing: z.boolean().optional(),
  }),
});

function callback(request: InboundWebhook, settings: ProviderSettings): WebhookEvent[] {
  verifySignature(
    settings.secrets.signingSecret ?? "",
    request.rawBody,
    request.headers.get("x-pas-signature"),
  );

  const event = callbackSchema.parse(JSON.parse(request.rawBody));
  const { data } = event;

  if (event.type === "email.status") {
    return [
      {
        kind: "email_status",
        externalId: event.id,
        providerRef: data.providerRef,
        status: data.status,
        summary: `Email ${data.providerRef}: ${data.status}`,
        data,
      },
    ];
  }

  return [
    {
      kind: "mail_tracking",
      externalId: event.id,
      providerRef: data.providerRef,
      status: data.status,
      trackingNumber: data.trackingNumber ?? null,
      occurredAt: data.occurredAt ? Temporal.Instant.from(data.occurredAt) : Temporal.Now.instant(),
      proofOfMailing: data.proofOfMailing ?? data.status === "mailed",
      summary: `Letter ${data.providerRef}: ${data.status.replaceAll("_", " ")}`,
      data,
    },
  ];
}

const manifestBase = {
  vendor: "Your system",
  configSchema,
  secrets: SECRETS,
  docsUrl: null,
  logo: { icon: "webhook" },
  testMode: true,
  liveMode: true,
  certified: false,
  builtin: false,
} as const;

class WebhookMailer implements EmailSender {
  constructor(
    private readonly settings: ProviderSettings,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    await post(this.fetchImpl, signedRequest(this.settings, "email.send", message));
  }
}

class WebhookPrintMail implements PrintMail {
  constructor(
    private readonly settings: ProviderSettings,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async sendLetter(letter: LetterRequest) {
    const answer = await post(
      this.fetchImpl,
      signedRequest(this.settings, "letter.send", {
        ...letter,
        document: {
          contentType: "application/pdf",
          base64: Buffer.from(letter.document).toString("base64"),
        },
      }),
    );

    const receipt = z
      .object({
        id: z.string().min(1),
        status: z.string().default("created"),
        trackingNumber: z.string().nullish(),
        expectedDeliveryDate: z.string().nullish(),
      })
      .parse(answer);

    return {
      providerRef: receipt.id,
      status: receipt.status,
      trackingNumber: receipt.trackingNumber ?? null,
      expectedDeliveryDate: receipt.expectedDeliveryDate ?? null,
    };
  }
}

export function webhookEmailProvider(fetchImpl: typeof fetch = fetch): ProviderPackage<"email"> {
  return {
    manifest: {
      ...manifestBase,
      id: "webhook_email",
      name: "Email webhook",
      category: "email",
      summary: "Hand each email to your own system as a signed webhook.",
      description:
        "Instead of sending mail, we POST each message (recipient, subject, text and tag) to your endpoint, signed with HMAC-SHA256. Your system delivers it and can report delivery or bounces back to the callback URL.",
      capabilities: ["Signed JSON payloads", "Delivery and bounce callbacks"],
      webhook: { kind: "callback", events: ["email.status"] },
    },
    create: (settings) => new WebhookMailer(settings, fetchImpl),
    check: (settings) => ping(fetchImpl, settings),
    webhook: async (request, settings) => callback(request, settings),
  };
}

export function webhookPrintMailProvider(
  fetchImpl: typeof fetch = fetch,
): ProviderPackage<"print_mail"> {
  return {
    manifest: {
      ...manifestBase,
      id: "webhook_print_mail",
      name: "Print and mail webhook",
      category: "print_mail",
      summary: "Send letters to your own print vendor as a signed webhook.",
      description:
        "We POST each letter (addresses, mail type and the PDF) to your endpoint, signed with HMAC-SHA256. Your system answers with its id, then calls back with tracking; a mailed status is stored as proof of mailing.",
      capabilities: [
        "Signed JSON payloads",
        "PDF included",
        "Tracking callbacks",
        "Proof of mailing on notices",
      ],
      webhook: { kind: "callback", events: ["letter.status"] },
    },
    create: (settings) => new WebhookPrintMail(settings, fetchImpl),
    check: (settings) => ping(fetchImpl, settings),
    webhook: async (request, settings) => callback(request, settings),
  };
}
