import type { TransportResult, WebhookRequest, WebhookTransport } from "../ports/transports";
import { assertPublicDestination } from "./destination-guard";
import { SIGNATURE_HEADER, signWebhook } from "./webhook-signature";

const TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const EXCERPT_CHARS = 2048;

/** Reads at most 1 MB of the response, then stops; we only keep an excerpt anyway. */
async function readCapped(response: Response): Promise<string> {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  while (size < MAX_RESPONSE_BYTES) {
    const { done, value } = await reader.read();

    if (done) break;

    chunks.push(value);
    size += value.byteLength;
  }

  await reader.cancel().catch(() => undefined);

  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, MAX_RESPONSE_BYTES));
}

/** Signed JSON POSTs with a 10 s timeout, no redirects and the destination guard on every send. */
export class HttpWebhookTransport implements WebhookTransport {
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly ticks: () => number = () => performance.now(),
    private readonly unixSeconds: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  assertDeliverable(url: string, allowPrivate: boolean): Promise<void> {
    return assertPublicDestination(url, allowPrivate);
  }

  async send(request: WebhookRequest): Promise<TransportResult> {
    const headers = {
      "content-type": "application/json",
      "user-agent": "PAS-Webhooks/1.0",
      ...request.headers,
      [SIGNATURE_HEADER]: signWebhook(request.secrets, request.body, this.unixSeconds()),
    };

    const logged = { url: request.url, headers: { ...headers, [SIGNATURE_HEADER]: "t=…,v1=…" } };
    const started = this.ticks();
    const elapsed = () => Math.round(this.ticks() - started);

    try {
      await assertPublicDestination(request.url, request.allowPrivate);

      const response = await this.fetchImpl(request.url, {
        method: "POST",
        headers,
        body: request.body,
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      const body = await readCapped(response);
      const ok = response.status >= 200 && response.status < 300;

      return {
        ok,
        statusCode: response.status,
        responseBody: body.slice(0, EXCERPT_CHARS),
        error: ok
          ? null
          : response.status >= 300 && response.status < 400
            ? "Redirects aren't followed"
            : `HTTP ${response.status}`,
        durationMs: elapsed(),
        request: logged,
      };
    } catch (error) {
      const timedOut = error instanceof DOMException && error.name === "TimeoutError";

      return {
        ok: false,
        statusCode: null,
        responseBody: null,
        error: timedOut ? "Timed out after 10 seconds" : (error as Error).message,
        durationMs: elapsed(),
        request: logged,
      };
    }
  }
}
