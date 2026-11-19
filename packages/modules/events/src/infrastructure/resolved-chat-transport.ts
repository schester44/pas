import type { TenantContext } from "@pas/kernel";
import type { ChatMessage, ChatTransport, TransportResult } from "../ports/transports";

export interface ResolvedChat {
  provider: string;
  post(message: {
    title: string;
    body: string;
    link: string | null;
    test: boolean;
  }): Promise<{ status: number; body: string }>;
}

/** Posts through whichever chat provider the tenant enabled in the integrations catalog. */
export class ResolvedChatTransport implements ChatTransport {
  constructor(
    private readonly resolve: (ctx: TenantContext) => Promise<ResolvedChat | null>,
    private readonly ticks: () => number = () => performance.now(),
  ) {}

  async provider(ctx: TenantContext): Promise<string | null> {
    return (await this.resolve(ctx).catch(() => null))?.provider ?? null;
  }

  async post(ctx: TenantContext, message: ChatMessage): Promise<TransportResult> {
    const started = this.ticks();
    const chat = await this.resolve(ctx).catch(() => null);
    const request = { url: chat ? `chat:${chat.provider}` : "chat", headers: {} };

    if (!chat) {
      return {
        ok: false,
        statusCode: null,
        responseBody: null,
        error: "No chat provider is enabled",
        durationMs: 0,
        request,
      };
    }

    try {
      const answer = await chat.post(message);

      return {
        ok: true,
        statusCode: answer.status,
        responseBody: answer.body,
        error: null,
        durationMs: Math.round(this.ticks() - started),
        request,
      };
    } catch (error) {
      return {
        ok: false,
        statusCode: null,
        responseBody: null,
        error: (error as Error).message,
        durationMs: Math.round(this.ticks() - started),
        request,
      };
    }
  }
}
