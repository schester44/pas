import type { HttpMethod } from "../domain/connector";

export interface OutgoingRequest {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
  anonymous: boolean;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export type HttpResult =
  | { ok: true; response: HttpResponse; durationMs: number }
  | { ok: false; error: string; durationMs: number };

export interface ExchangeRecord {
  execId: string;
  stepId: string;
  kind: "request" | "poll" | "callback" | "compensation";
  attempt: number;
  request: { method?: string; url?: string; headers?: Record<string, string>; body?: unknown };
  response: HttpResponse | null;
  ok: boolean;
  error: string | null;
  durationMs: number;
}

/** What the flow runner needs from the outside world for one run. */
export interface FlowIO {
  /** Applies the connection's credentials (unless anonymous) and never throws on HTTP status. */
  send(request: OutgoingRequest): Promise<HttpResult>;
  /** Persists one exchange with secrets redacted; idempotent on `execId`. */
  record(exchange: ExchangeRecord): Promise<void>;
  /** Pairs a correlation key with this run so an inbound callback can resume it. */
  awaitCallback(correlation: string, event: string): Promise<void>;
  /** In-process wait for short pauses (see `inlineWaitSeconds`). */
  sleep?(ms: number): Promise<void>;
}
