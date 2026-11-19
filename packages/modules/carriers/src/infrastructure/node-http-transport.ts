import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { HttpResult } from "../ports/flow-io";
import type { HttpTransport, TokenCache, WireRequest } from "../ports/services";

interface RawResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

// node:https instead of fetch: client certificates for mTLS need per-request TLS options.
function exchange(request: WireRequest): Promise<RawResponse> {
  const url = new URL(request.url);
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const req = send(
      url,
      {
        method: request.method,
        headers: {
          ...request.headers,
          ...(request.body !== undefined && { "content-length": Buffer.byteLength(request.body) }),
        },
        timeout: request.timeoutMs,
        ...(request.tls && { cert: request.tls.certificate, key: request.tls.privateKey }),
      },
      (res) => {
        const chunks: Buffer[] = [];

        res.on("data", (chunk: Buffer) => chunks.push(chunk));

        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: Object.fromEntries(
              Object.entries(res.headers).map(([k, v]) => [
                k,
                Array.isArray(v) ? v.join(", ") : (v ?? ""),
              ]),
            ),
            body: Buffer.concat(chunks),
          }),
        );

        res.on("error", reject);
      },
    );

    req.on("timeout", () => req.destroy(new Error(`Timed out after ${request.timeoutMs} ms`)));
    req.on("error", reject);

    if (request.body !== undefined) req.write(request.body);

    req.end();
  });
}

function parse(raw: RawResponse): unknown {
  const text = raw.body.toString("utf8");

  if (!text) return null;

  if ((raw.headers["content-type"] ?? "").includes("json") || /^[[{]/.test(text.trim())) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  return text;
}

export class NodeHttpTransport implements HttpTransport {
  async send(request: WireRequest): Promise<HttpResult> {
    const started = performance.now();

    try {
      const raw = await exchange(request);

      return {
        ok: true,
        response: { status: raw.status, headers: raw.headers, body: parse(raw) },
        durationMs: Math.round(performance.now() - started),
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Math.round(performance.now() - started),
      };
    }
  }

  async download(request: WireRequest) {
    try {
      const raw = await exchange(request);

      if (raw.status >= 300)
        return { ok: false as const, error: `The carrier answered ${raw.status}` };

      return {
        ok: true as const,
        body: new Uint8Array(raw.body),
        contentType: raw.headers["content-type"] ?? "application/octet-stream",
      };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export class MemoryTokenCache implements TokenCache {
  private readonly tokens = new Map<string, { token: string; expiresAt: number }>();

  get(key: string) {
    return this.tokens.get(key);
  }

  set(key: string, value: { token: string; expiresAt: number }) {
    this.tokens.set(key, value);
  }

  delete(key: string) {
    this.tokens.delete(key);
  }
}
