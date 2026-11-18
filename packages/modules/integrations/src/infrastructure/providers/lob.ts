import { z } from "zod";
import type {
  LetterReceipt,
  LetterRequest,
  MailType,
  PostalAddress,
  PrintMail,
} from "../../ports/adapters";
import type { ProviderPackage, ProviderSettings, WebhookEvent } from "../../ports/provider-catalog";
import { failure, hmacHex, safeEqual } from "./signing";

const API = "https://api.lob.com/v1";

const configSchema = z.object({
  color: z.boolean().default(false).meta({ title: "Print in color" }),
  doubleSided: z.boolean().default(true).meta({ title: "Print double-sided" }),
});

const EXTRA_SERVICE: Record<MailType, string | null> = {
  first_class: null,
  certified: "certified",
  certified_return_receipt: "certified_return_receipt",
};

// The events that put a piece in the USPS mail stream: proof of mailing (PLAN §17.3).
const MAILED = new Set(["letter.mailed", "letter.certified.mailed"]);

const TRACKING_EVENTS = [
  "letter.mailed",
  "letter.in_transit",
  "letter.in_local_area",
  "letter.processed_for_delivery",
  "letter.delivered",
  "letter.returned_to_sender",
  "letter.certified.mailed",
  "letter.certified.delivered",
];

const authHeader = (settings: ProviderSettings) =>
  `Basic ${Buffer.from(`${settings.secrets.apiKey ?? ""}:`).toString("base64")}`;

function appendAddress(form: FormData, prefix: string, address: PostalAddress) {
  form.append(`${prefix}[name]`, address.name);
  form.append(`${prefix}[address_line1]`, address.line1);

  if (address.line2) form.append(`${prefix}[address_line2]`, address.line2);

  form.append(`${prefix}[address_city]`, address.city);
  form.append(`${prefix}[address_state]`, address.region);
  form.append(`${prefix}[address_zip]`, address.postalCode);
  form.append(`${prefix}[address_country]`, address.country);
}

export function lobLetterRequest(settings: ProviderSettings, letter: LetterRequest): Request {
  const config = configSchema.parse(settings.config);
  const form = new FormData();
  form.append("description", letter.description.slice(0, 255));
  appendAddress(form, "to", letter.to);
  appendAddress(form, "from", letter.from);

  form.append(
    "file",
    new Blob([new Uint8Array(letter.document)], { type: "application/pdf" }),
    "letter.pdf",
  );

  form.append("color", String(config.color));
  form.append("double_sided", String(config.doubleSided));
  form.append("mail_type", "usps_first_class");
  form.append("use_type", "operational");
  form.append("metadata[reference]", letter.reference.slice(0, 500));

  const extra = EXTRA_SERVICE[letter.mailType];

  if (extra) form.append("extra_service", extra);

  return new Request(`${API}/letters`, {
    method: "POST",
    headers: { authorization: authHeader(settings), "idempotency-key": letter.reference },
    body: form,
  });
}

class LobPrintMail implements PrintMail {
  constructor(
    private readonly settings: ProviderSettings,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async sendLetter(letter: LetterRequest): Promise<LetterReceipt> {
    const response = await this.fetchImpl(lobLetterRequest(this.settings, letter));

    if (!response.ok) throw await failure(response);

    const created = (await response.json()) as {
      id: string;
      tracking_number?: string | null;
      expected_delivery_date?: string | null;
    };

    return {
      providerRef: created.id,
      status: "created",
      trackingNumber: created.tracking_number ?? null,
      expectedDeliveryDate: created.expected_delivery_date ?? null,
    };
  }
}

const lobEvent = z.object({
  id: z.string(),
  date_created: z.string(),
  event_type: z.object({ id: z.string() }),
  body: z.looseObject({ id: z.string(), tracking_number: z.string().nullish() }),
});

/** Lob signs `timestamp.body` with the webhook secret (HMAC-SHA256, hex). */
export function verifyLobSignature(secret: string, body: string, headers: Headers): void {
  const timestamp = headers.get("lob-signature-timestamp") ?? "";
  const signature = headers.get("lob-signature") ?? "";

  if (!timestamp || !signature) throw new Error("missing Lob signature");

  const ms = Number(timestamp) > 1e12 ? Number(timestamp) : Number(timestamp) * 1000;

  if (!Number.isFinite(ms) || Math.abs(Date.now() - ms) > 300_000) {
    throw new Error("Lob signature is too old");
  }

  if (!safeEqual(signature, hmacHex(secret, `${timestamp}.${body}`))) {
    throw new Error("Lob signature mismatch");
  }
}

export function lobProvider(fetchImpl: typeof fetch = fetch): ProviderPackage<"print_mail"> {
  return {
    manifest: {
      id: "lob",
      name: "Lob",
      vendor: "Lob",
      category: "print_mail",
      summary: "Print and mail letters first-class or certified, with USPS tracking.",
      description:
        "Prints notices and mails them by USPS first-class or certified mail. Tracking events arrive by webhook; the mailed event is stored as proof of mailing on the notice. Test keys render letters without mailing them.",
      capabilities: [
        "First-class mail",
        "Certified mail and return receipt",
        "USPS tracking",
        "Proof of mailing on notices",
      ],
      configSchema,
      secrets: [
        { key: "apiKey", label: "API key", description: "test_… or live_…" },
        {
          key: "webhookSecret",
          label: "Webhook secret",
          description: "From the webhook you add in Lob.",
          optional: true,
        },
      ],
      docsUrl: "https://docs.lob.com/#tag/Letters",
      logo: { mark: "L" },
      testMode: true,
      liveMode: true,
      certified: true,
      builtin: false,
      webhook: { kind: "lob", events: TRACKING_EVENTS },
    },

    create: (settings) => new LobPrintMail(settings, fetchImpl),

    async check(settings) {
      const key = settings.secrets.apiKey ?? "";
      const mode = key.startsWith("live_") ? "live" : key.startsWith("test_") ? "test" : null;

      if (!mode) return { ok: false, detail: "Lob API keys start with test_ or live_" };

      if (mode !== settings.environment) {
        return {
          ok: false,
          detail: `That's a ${mode} key; this install is in ${settings.environment} mode`,
        };
      }

      const response = await fetchImpl(`${API}/addresses?limit=1`, {
        headers: { authorization: authHeader(settings) },
      });

      if (!response.ok) throw await failure(response);

      return { ok: true, detail: `API key accepted, ${mode} mode` };
    },

    async webhook(request, settings) {
      const secret = settings.secrets.webhookSecret;

      if (!secret) throw new Error("no webhook secret is set");

      verifyLobSignature(secret, request.rawBody, request.headers);
      const event = lobEvent.parse(JSON.parse(request.rawBody));
      const type = event.event_type.id;

      if (!type.startsWith("letter.")) return [];

      const result: WebhookEvent = {
        kind: "mail_tracking",
        externalId: event.id,
        providerRef: event.body.id,
        status: type.replace(/^letter\.(certified\.)?/, ""),
        trackingNumber: event.body.tracking_number ?? null,
        occurredAt: Temporal.Instant.from(new Date(event.date_created).toISOString()),
        proofOfMailing: MAILED.has(type),
        summary: `${event.body.id}: ${type.replace("letter.", "").replaceAll(/[._]/g, " ")}`,
        data: { type, trackingNumber: event.body.tracking_number ?? null },
      };

      return [result];
    },
  };
}
