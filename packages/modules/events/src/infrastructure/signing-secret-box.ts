import { randomBytes } from "node:crypto";
import type { Sealed } from "../domain/subscription";
import type { SigningSecretBox } from "../ports/platform";

/** `whsec_` secrets sealed with the platform's secret box (the integrations AES-GCM keyring). */
export class SealedSigningSecrets implements SigningSecretBox {
  constructor(
    private readonly box: {
      seal(plaintext: string, context: string): object;
      open(sealed: never, context: string): string;
    },
  ) {}

  generate(): string {
    return `whsec_${randomBytes(24).toString("base64url")}`;
  }

  seal(plaintext: string, context: string): Sealed {
    return this.box.seal(plaintext, context) as Sealed;
  }

  open(sealed: Sealed, context: string): string {
    return this.box.open(sealed as never, context);
  }
}
