import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "pas-signature";
export const DEFAULT_TOLERANCE_S = 300;

const hmac = (secret: string, payload: string) =>
  createHmac("sha256", secret).update(payload).digest("hex");

/**
 * `Pas-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">`, Stripe-style. During a
 * secret rotation there's one `v1` per active secret, newest first.
 */
export function signWebhook(secrets: readonly string[], body: string, timestamp: number): string {
  return [
    `t=${timestamp}`,
    ...secrets.map((secret) => `v1=${hmac(secret, `${timestamp}.${body}`)}`),
  ].join(",");
}

export type SignatureCheck = { ok: true } | { ok: false; reason: string };

/** What receivers run: any `v1` that matches the secret, within the replay tolerance. */
export function verifyWebhook(input: {
  secret: string;
  body: string;
  header: string | null;
  now: number;
  toleranceSeconds?: number;
}): SignatureCheck {
  const parts = (input.header ?? "").split(",").map((part) => part.trim().split("=", 2));
  const timestamp = Number(parts.find(([key]) => key === "t")?.[1]);

  const signatures = parts
    .filter(([key, value]) => key === "v1" && value)
    .map(([, value]) => value!);

  if (!Number.isInteger(timestamp) || signatures.length === 0) {
    return { ok: false, reason: "missing signature" };
  }

  if (Math.abs(input.now - timestamp) > (input.toleranceSeconds ?? DEFAULT_TOLERANCE_S)) {
    return { ok: false, reason: "timestamp outside the tolerance" };
  }

  const expected = Buffer.from(hmac(input.secret, `${timestamp}.${input.body}`));

  const matches = signatures.some((signature) => {
    const given = Buffer.from(signature);

    return given.length === expected.length && timingSafeEqual(given, expected);
  });

  return matches ? { ok: true } : { ok: false, reason: "no signature matches" };
}
