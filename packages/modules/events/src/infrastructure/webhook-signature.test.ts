import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signWebhook, verifyWebhook } from "./webhook-signature";

const body = JSON.stringify({ id: "evt_1", type: "quote.bound" });
const at = 1_795_000_000;

describe("webhook signatures", () => {
  it("signs t.body with HMAC-SHA256, one v1 per active secret", () => {
    const header = signWebhook(["whsec_new", "whsec_old"], body, at);
    const expected = createHmac("sha256", "whsec_new").update(`${at}.${body}`).digest("hex");

    expect(header.split(",")).toEqual([
      `t=${at}`,
      `v1=${expected}`,
      expect.stringMatching(/^v1=[0-9a-f]{64}$/),
    ]);

    expect(verifyWebhook({ secret: "whsec_old", body, header, now: at })).toEqual({ ok: true });
  });

  it("rejects tampered bodies, wrong secrets, stale timestamps and missing headers", () => {
    const header = signWebhook(["whsec_a"], body, at);

    expect(verifyWebhook({ secret: "whsec_a", body: `${body} `, header, now: at }).ok).toBe(false);
    expect(verifyWebhook({ secret: "whsec_b", body, header, now: at }).ok).toBe(false);
    expect(verifyWebhook({ secret: "whsec_a", body, header, now: at + 301 }).ok).toBe(false);
    expect(verifyWebhook({ secret: "whsec_a", body, header, now: at + 299 }).ok).toBe(true);
    expect(verifyWebhook({ secret: "whsec_a", body, header: null, now: at }).ok).toBe(false);
  });
});
