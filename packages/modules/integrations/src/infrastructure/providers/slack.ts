import { z } from "zod";
import type { ChatChannel, ChatPost } from "../../ports/adapters";
import type { ProviderPackage, ProviderSettings } from "../../ports/provider-catalog";

const SLACK_HOOK = /^https:\/\/hooks\.slack(-gov)?\.com\/services\/[A-Za-z0-9/_-]+$/;

const escape = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** Block Kit: a bold title, one line of detail and a link back to the record in admin. */
export function slackMessage(message: ChatPost) {
  const title = `${message.test ? "[Test] " : ""}${message.title}`;

  return {
    text: `${title}${message.body ? `: ${message.body}` : ""}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${escape(title)}*${message.body ? `\n${escape(message.body)}` : ""}`,
        },
      },
      ...(message.link
        ? [
            {
              type: "context",
              elements: [{ type: "mrkdwn", text: `<${message.link}|Open in PAS>` }],
            },
          ]
        : []),
    ],
  };
}

class SlackIncomingWebhook implements ChatChannel {
  constructor(
    private readonly settings: ProviderSettings,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async post(message: ChatPost) {
    const url = this.settings.secrets.webhookUrl ?? "";

    if (!SLACK_HOOK.test(url)) throw new Error("The Slack webhook URL isn't a hooks.slack.com URL");

    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(slackMessage(message)),
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });

    const body = (await response.text().catch(() => "")).slice(0, 2048);

    if (!response.ok) throw new Error(`Slack answered ${response.status}: ${body || "no body"}`);

    return { status: response.status, body };
  }
}

/** Incoming webhooks to start; a Slack app with OAuth and channel picking is a follow-up. */
export function slackProvider(fetchImpl: typeof fetch = fetch): ProviderPackage<"chat"> {
  return {
    manifest: {
      id: "slack",
      name: "Slack",
      vendor: "Slack",
      category: "chat",
      summary: "Post referrals, failed payments and other events to a Slack channel.",
      description:
        "Posts a short message with a link back to admin for each event a Slack destination subscribes to. Create an incoming webhook for the channel in Slack and paste its URL here; choose the events under Settings → Notifications.",
      capabilities: ["Incoming webhook", "Formatted per event type", "Links back to admin"],
      configSchema: z.object({}),
      secrets: [
        {
          key: "webhookUrl",
          label: "Incoming webhook URL",
          description: "https://hooks.slack.com/services/… for the channel to post to.",
        },
      ],
      docsUrl: "https://api.slack.com/messaging/webhooks",
      logo: { mark: "S" },
      testMode: true,
      liveMode: true,
      certified: true,
      builtin: false,
      webhook: null,
      requiresCredentials: true,
    },
    create: (settings) => new SlackIncomingWebhook(settings, fetchImpl),
    async check(settings) {
      await new SlackIncomingWebhook(settings, fetchImpl).post({
        title: "PAS is connected",
        body: "Event notifications for this workspace will post here.",
        link: null,
        test: true,
      });

      return { ok: true, detail: "Posted a test message to the channel" };
    },
  };
}
