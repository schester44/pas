import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { SealedSecret } from "../domain/install";
import type { SecretBox } from "../ports/secret-box";

interface Key {
  id: string;
  key: Buffer;
}

const decodeKey = (value: string): Buffer =>
  /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");

/**
 * AES-256-GCM with a keyring: `INTEGRATIONS_SECRET_KEY=k2:<base64>,k1:<base64>`. The first key
 * seals; any listed key opens, so rotating is "prepend a key, re-save, drop the old one".
 */
export class AesSecretBox implements SecretBox {
  private parsed: Key[] | undefined;

  constructor(private readonly keyring: string | undefined) {}

  private get keys(): Key[] {
    this.parsed ??= (this.keyring ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry, index) => {
        const [id, value] = entry.includes(":") ? entry.split(":", 2) : [`k${index + 1}`, entry];
        const key = decodeKey(value!);

        if (key.length !== 32) throw new Error(`INTEGRATIONS_SECRET_KEY ${id} must be 32 bytes`);

        return { id: id!, key };
      });

    return this.parsed;
  }

  seal(plaintext: string, context: string): SealedSecret {
    const { id, key } = this.active();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(context));
    const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

    return {
      keyId: id,
      iv: iv.toString("base64"),
      data: data.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
    };
  }

  open(sealed: SealedSecret, context: string): string {
    const key = this.keys.find((k) => k.id === sealed.keyId);

    if (!key) throw new Error(`Integration secret key ${sealed.keyId} isn't configured`);

    const decipher = createDecipheriv("aes-256-gcm", key.key, Buffer.from(sealed.iv, "base64"));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));

    try {
      return Buffer.concat([
        decipher.update(Buffer.from(sealed.data, "base64")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new Error("An integration secret failed its integrity check");
    }
  }

  private active(): Key {
    const [key] = this.keys;

    if (!key) throw new Error("Set INTEGRATIONS_SECRET_KEY to store integration secrets");

    return key;
  }
}
