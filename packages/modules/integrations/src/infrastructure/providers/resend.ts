import { Resend } from "resend";
import { z } from "zod";
import type { EmailMessage, EmailSender } from "../../ports/adapters";
import type { ProviderPackage, ProviderSettings, WebhookEvent } from "../../ports/provider-catalog";

const configSchema = z.object({
  domain: z
    .string()
    .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, "A domain such as mail.example.com")
    .meta({ title: "Sending domain", description: "Verified in Resend." }),
  fromAddress: z
    .email()
    .meta({ title: "From address", description: "An address on the sending domain." }),
  fromName: z.string().max(100).optional().meta({ title: "From name" }),
});

const STATUS_EVENTS = [
  "email.sent",
  "email.delivered",
  "email.delivery_delayed",
  "email.bounced",
  "email.complained",
  "email.failed",
];

function client(settings: ProviderSettings, baseUrl?: string) {
  return new Resend(settings.secrets.apiKey ?? "", { ...(baseUrl && { baseUrl }) });
}

export function resendEmail(settings: ProviderSettings, message: EmailMessage) {
  const config = configSchema.parse(settings.config);

  return {
    from: config.fromName ? `${config.fromName} <${config.fromAddress}>` : config.fromAddress,
    to: [message.to],
    subject: message.subject,
    text: message.text,
    // Resend tags allow only ASCII letters, digits, _ and -.
    tags: [{ name: "type", value: message.tag.replaceAll(/[^\w-]/g, "_") }],
  };
}

class ResendMailer implements EmailSender {
  constructor(
    private readonly settings: ProviderSettings,
    private readonly baseUrl?: string,
  ) {}

  async send(message: EmailMessage) {
    const { data, error } = await client(this.settings, this.baseUrl).emails.send(
      resendEmail(this.settings, message),
    );

    if (error) throw new Error(`Resend: ${error.message}`);

    return { messageId: data?.id ?? null };
  }
}

export function resendProvider(options: { baseUrl?: string } = {}): ProviderPackage<"email"> {
  return {
    manifest: {
      id: "resend",
      name: "Resend",
      vendor: "Resend",
      category: "email",
      summary: "Transactional email from your own domain, with delivery and bounce webhooks.",
      description:
        "Sends sign-in codes, portal invitations and notices from your verified domain. Delivery, delay, bounce and complaint events come back by signed webhook and show here per message. Resend has no test keys, so sandboxes use the developer mailbox.",
      capabilities: ["Your sending domain", "Delivery and bounce webhooks", "Message tags"],
      configSchema,
      secrets: [
        { key: "apiKey", label: "API key", description: "re_… with sending access." },
        {
          key: "webhookSecret",
          label: "Webhook signing secret",
          description: "whsec_… from the webhook you add in Resend.",
          optional: true,
        },
      ],
      docsUrl: "https://resend.com/docs/api-reference/emails/send-email",
      logo: { mark: "R" },
      testMode: false,
      liveMode: true,
      certified: true,
      builtin: false,
      webhook: { kind: "resend", events: STATUS_EVENTS },
    },

    create: (settings) => new ResendMailer(settings, options.baseUrl),

    async check(settings) {
      const config = configSchema.parse(settings.config);
      const { data, error } = await client(settings, options.baseUrl).domains.list();

      if (error) throw new Error(error.message);

      const domain = data?.data.find((d) => d.name === config.domain);

      if (!domain)
        return { ok: false, detail: `${config.domain} isn't a domain on this Resend account` };

      if (domain.status !== "verified") {
        return {
          ok: false,
          detail: `${config.domain} is ${domain.status.replaceAll("_", " ")} in Resend`,
        };
      }

      if (!config.fromAddress.endsWith(`@${config.domain}`)) {
        return { ok: false, detail: `The from address isn't on ${config.domain}` };
      }

      return { ok: true, detail: `${config.domain} is verified` };
    },

    async webhook(request, settings) {
      const secret = settings.secrets.webhookSecret;

      if (!secret) throw new Error("no webhook signing secret is set");

      // Verifying needs no API call, but the SDK refuses to construct without a key.
      const verifier = new Resend(settings.secrets.apiKey || "re_verify_only");

      const event = verifier.webhooks.verify({
        payload: request.rawBody,
        headers: {
          id: request.headers.get("svix-id") ?? "",
          timestamp: request.headers.get("svix-timestamp") ?? "",
          signature: request.headers.get("svix-signature") ?? "",
        },
        webhookSecret: secret,
      });

      if (!STATUS_EVENTS.includes(event.type)) return [];

      const data = event.data as { email_id: string; to?: string[]; bounce?: { message?: string } };
      const status = event.type.replace("email.", "");

      const result: WebhookEvent = {
        kind: "email_status",
        externalId: request.headers.get("svix-id") ?? `${data.email_id}:${event.type}`,
        providerRef: data.email_id,
        status,
        summary: `Email ${data.email_id} ${status.replaceAll("_", " ")}${data.bounce?.message ? `: ${data.bounce.message}` : ""}`,
        data: { type: event.type, to: data.to ?? [], createdAt: event.created_at },
      };

      return [result];
    },
  };
}
