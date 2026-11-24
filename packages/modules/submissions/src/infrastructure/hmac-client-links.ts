import { createHmac, timingSafeEqual } from "node:crypto";
import type { ClientLinks } from "../ports/client-links";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** `<request id>.<HMAC-SHA256 of it>`; the purpose prefix keeps the MAC distinct from other uses of the key. */
export class HmacClientLinks implements ClientLinks {
  constructor(private readonly secret: string) {
    if (secret.length < 32)
      throw new Error("The client link secret must be at least 32 characters");
  }

  token(requestId: string): string {
    return `${requestId}.${this.mac(requestId)}`;
  }

  verify(token: string): string | null {
    const [id, mac] = token.split(".");

    if (!id || !mac || !UUID.test(id)) return null;

    const expected = Buffer.from(this.mac(id));
    const given = Buffer.from(mac);

    return expected.length === given.length && timingSafeEqual(expected, given) ? id : null;
  }

  private mac(id: string): string {
    return createHmac("sha256", this.secret).update(`client-request:${id}`).digest("base64url");
  }
}
