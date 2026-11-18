import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AesSecretBox } from "./aes-secret-box";

const key = () => randomBytes(32).toString("base64");

describe("AesSecretBox", () => {
  it("round-trips a secret and opens it after the key rotates", () => {
    const old = key();
    const sealed = new AesSecretBox(`k1:${old}`).seal("sk_test_51abc", "t1:i1:secretKey");

    expect(sealed.keyId).toBe("k1");
    expect(sealed.data).not.toContain("sk_test");

    const rotated = new AesSecretBox(`k2:${key()},k1:${old}`);

    expect(rotated.open(sealed, "t1:i1:secretKey")).toBe("sk_test_51abc");
    expect(rotated.seal("x", "c").keyId).toBe("k2");
  });

  it("rejects tampered ciphertext, a swapped tag and a value moved to another tenant", () => {
    const box = new AesSecretBox(key());
    const sealed = box.seal("whsec_123", "t1:i1:webhookSecret");
    const bytes = Buffer.from(sealed.data, "base64");
    bytes[0]! ^= 1;

    expect(() =>
      box.open({ ...sealed, data: bytes.toString("base64") }, "t1:i1:webhookSecret"),
    ).toThrow("integrity");

    expect(() =>
      box.open(
        { ...sealed, tag: box.seal("whsec_123", "t1:i1:webhookSecret").tag },
        "t1:i1:webhookSecret",
      ),
    ).toThrow("integrity");

    expect(() => box.open(sealed, "t2:i1:webhookSecret")).toThrow("integrity");
  });
});
