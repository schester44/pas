import type { TenantContext } from "@pas/kernel";

export interface TransportResult {
  ok: boolean;
  statusCode: number | null;
  responseBody: string | null;
  error: string | null;
  durationMs: number;
  request: { url: string; headers: Record<string, string> };
}

export interface WebhookRequest {
  url: string;
  body: string;
  /** Plain signing secrets, newest first; each one adds a `v1=` to the signature header. */
  secrets: readonly string[];
  headers: Record<string, string>;
  /** Private and loopback addresses are refused unless this is a sandbox or dev. */
  allowPrivate: boolean;
}

export interface WebhookTransport {
  send(request: WebhookRequest): Promise<TransportResult>;
  /** Throws when a URL can never be delivered to (scheme, private address in production). */
  assertDeliverable(url: string, allowPrivate: boolean): Promise<void>;
}

export interface ChatMessage {
  title: string;
  body: string;
  link: string | null;
  eventType: string;
  test: boolean;
}

/** The tenant's chat provider from the integrations catalog (Slack today). */
export interface ChatTransport {
  post(ctx: TenantContext, message: ChatMessage): Promise<TransportResult>;
  /** The provider's name, or null when no chat provider is enabled. */
  provider(ctx: TenantContext): Promise<string | null>;
}
