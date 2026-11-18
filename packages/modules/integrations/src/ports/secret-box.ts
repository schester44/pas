import type { SealedSecret } from "../domain/install";

/** Authenticated encryption for install secrets. `context` binds a value to its tenant, install and field. */
export interface SecretBox {
  seal(plaintext: string, context: string): SealedSecret;
  open(sealed: SealedSecret, context: string): string;
}
