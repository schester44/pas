import { z } from "zod";
import type { EmailMessage, EmailSender } from "../../ports/adapters";
import type { ProviderPackage, ProviderSettings } from "../../ports/provider-catalog";
import { failure } from "./signing";

const API = "https://api.postmarkapp.com";

// Postmark validates requests made with this token without delivering anything.
export const POSTMARK_TEST_TOKEN = "POSTMARK_API_TEST";

const configSchema = z.object({
  fromAddress: z
    .email()
    .meta({ title: "From address", description: "A verified sender signature or domain." }),
  fromName: z.string().max(100).optional().meta({ title: "From name" }),
  messageStream: z
    .string()
    .default("outbound")
    .meta({ title: "Message stream", description: "Postmark's transactional stream is outbound." }),
});

export function postmarkRequest(settings: ProviderSettings, message: EmailMessage): Request {
  const config = configSchema.parse(settings.config);

  return new Request(`${API}/email`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-postmark-server-token": settings.secrets.serverToken ?? "",
    },
    body: JSON.stringify({
      From: config.fromName ? `${config.fromName} <${config.fromAddress}>` : config.fromAddress,
      To: message.to,
      Subject: message.subject,
      TextBody: message.text,
      Tag: message.tag,
      MessageStream: config.messageStream,
      Metadata: { tenant: settings.tenantId },
    }),
  });
}

class PostmarkMailer implements EmailSender {
  constructor(
    private readonly settings: ProviderSettings,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const response = await this.fetchImpl(postmarkRequest(this.settings, message));

    if (!response.ok) throw await failure(response);
  }
}

export function postmarkProvider(fetchImpl: typeof fetch = fetch): ProviderPackage<"email"> {
  return {
    manifest: {
      id: "postmark",
      name: "Postmark",
      vendor: "Postmark",
      category: "email",
      summary: "Transactional email with a dedicated stream and fast delivery.",
      description:
        "Sends sign-in codes, portal invitations and notices through Postmark's transactional message stream. In test mode, use the server token POSTMARK_API_TEST: Postmark checks every request and delivers nothing.",
      capabilities: ["Transactional stream", "Tags per message type", "Test token"],
      configSchema,
      secrets: [{ key: "serverToken", label: "Server API token" }],
      docsUrl: "https://postmarkapp.com/developer/api/email-api",
      logo: { mark: "P" },
      testMode: true,
      liveMode: true,
      certified: true,
      builtin: false,
      webhook: null,
    },

    create: (settings) => new PostmarkMailer(settings, fetchImpl),

    async check(settings) {
      const token = settings.secrets.serverToken ?? "";

      if (token === POSTMARK_TEST_TOKEN) {
        const response = await fetchImpl(
          postmarkRequest(settings, {
            to: "test@blackhole.postmarkapp.com",
            subject: "Connection test",
            text: "Connection test",
            tag: "connection_test",
          }),
        );

        if (!response.ok) throw await failure(response);

        return {
          ok: true,
          detail: "Test token accepted; requests are validated, nothing is delivered",
        };
      }

      if (settings.environment === "test") {
        return { ok: false, detail: `Use the ${POSTMARK_TEST_TOKEN} token in test mode` };
      }

      const response = await fetchImpl(`${API}/server`, {
        headers: { accept: "application/json", "x-postmark-server-token": token },
      });

      if (!response.ok) throw await failure(response);

      const server = (await response.json()) as { Name?: string };

      return { ok: true, detail: `Connected to server ${server.Name ?? ""}`.trim() };
    },
  };
}
