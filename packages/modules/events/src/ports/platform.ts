import type { TenantContext, TenantId } from "@pas/kernel";
import type { Sealed } from "../domain/subscription";
import type { Audience, EventSubject } from "../domain/event-types";

export interface SigningSecretBox {
  generate(): string;
  seal(plaintext: string, context: string): Sealed;
  open(sealed: Sealed, context: string): string;
}

export interface TenantMember {
  userId: string;
  name: string;
  email: string;
  audience: Audience | null;
  admin: boolean;
}

export interface TenantMembers {
  list(ctx: TenantContext): Promise<TenantMember[]>;
}

export interface EventEnvironments {
  isSandbox(tenantId: TenantId): Promise<boolean>;
  /** Private and loopback webhook URLs are allowed in sandboxes and local development. */
  allowsPrivateUrls(tenantId: TenantId): Promise<boolean>;
}

export interface AdminLinks {
  url(subject: EventSubject | null): string | null;
}

export interface AdminMailer {
  send(
    ctx: TenantContext,
    message: { to: string; subject: string; text: string; tag: string },
  ): Promise<void>;
}
