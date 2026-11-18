import { createHmac, timingSafeEqual } from "node:crypto";

const TOLERANCE_S = 300;

const hmac = (secret: string, payload: string) =>
  createHmac("sha256", secret).update(payload).digest("hex");

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  return left.length === right.length && timingSafeEqual(left, right);
}

/** `X-PAS-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">`, the shape Stripe uses. */
export function signPayload(secret: string, body: string, at = Math.floor(Date.now() / 1000)) {
  return `t=${at},v1=${hmac(secret, `${at}.${body}`)}`;
}

export function verifySignature(secret: string, body: string, header: string | null): void {
  const parts = Object.fromEntries(
    (header ?? "").split(",").map((part) => part.trim().split("=", 2) as [string, string]),
  );

  const at = Number(parts.t);

  if (!parts.v1 || !Number.isFinite(at)) throw new Error("missing signature");

  if (Math.abs(Date.now() / 1000 - at) > TOLERANCE_S) throw new Error("signature is too old");

  if (!safeEqual(parts.v1, hmac(secret, `${at}.${body}`))) throw new Error("signature mismatch");
}

export function hmacHex(secret: string, payload: string): string {
  return hmac(secret, payload);
}

export async function failure(response: Response): Promise<Error> {
  const body = await response.text().catch(() => "");
  let message = body.slice(0, 300);

  try {
    const parsed = JSON.parse(body) as {
      message?: string;
      Message?: string;
      error?: { message?: string };
    };

    message = parsed.error?.message ?? parsed.message ?? parsed.Message ?? message;
  } catch {}

  return new Error(`${response.status} ${message}`.trim());
}
