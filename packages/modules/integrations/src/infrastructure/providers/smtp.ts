import { createTransport } from "nodemailer";
import { z } from "zod";
import type { EmailMessage, EmailSender } from "../../ports/adapters";
import type { ProviderPackage, ProviderSettings } from "../../ports/provider-catalog";

const configSchema = z.object({
  host: z.string().min(1).meta({ title: "Host" }),
  port: z.coerce.number().int().min(1).max(65535).default(587).meta({ title: "Port" }),
  secure: z.boolean().default(false).meta({
    title: "Use TLS from the start",
    description: "On for port 465; STARTTLS is used otherwise.",
  }),
  username: z.string().optional().meta({ title: "Username" }),
  fromAddress: z.email().meta({ title: "From address" }),
  fromName: z.string().max(100).optional().meta({ title: "From name" }),
});

function transport(settings: ProviderSettings) {
  const config = configSchema.parse(settings.config);

  return {
    config,
    transporter: createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      ...(config.username && {
        auth: { user: config.username, pass: settings.secrets.password ?? "" },
      }),
      connectionTimeout: 8_000,
    }),
  };
}

class SmtpMailer implements EmailSender {
  constructor(private readonly settings: ProviderSettings) {}

  async send(message: EmailMessage): Promise<void> {
    const { config, transporter } = transport(this.settings);

    await transporter.sendMail({
      from: config.fromName
        ? { name: config.fromName, address: config.fromAddress }
        : config.fromAddress,
      to: message.to,
      subject: message.subject,
      text: message.text,
      headers: { "X-PAS-Tag": message.tag },
    });
  }
}

export const smtpProvider: ProviderPackage<"email"> = {
  manifest: {
    id: "smtp",
    name: "SMTP",
    vendor: "Any mail server",
    category: "email",
    summary: "Send through your own mail server or relay.",
    description:
      "For self-hosted installs: connects to any SMTP server or relay (Amazon SES, Mailgun, your own Postfix). SMTP has no test mode, so sandboxes can't use it.",
    capabilities: ["STARTTLS or TLS", "Username and password auth"],
    configSchema,
    secrets: [{ key: "password", label: "Password", optional: true }],
    docsUrl: "https://nodemailer.com/smtp/",
    logo: { icon: "mail" },
    testMode: false,
    liveMode: true,
    certified: false,
    builtin: false,
    webhook: null,
  },

  create: (settings) => new SmtpMailer(settings),

  async check(settings) {
    const { config, transporter } = transport(settings);

    await transporter.verify();

    return { ok: true, detail: `Connected to ${config.host}:${config.port}` };
  },
};
