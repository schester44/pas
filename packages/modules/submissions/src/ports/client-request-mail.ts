import type { TenantContext } from "@pas/kernel";

/** Outbound email to the insured, resolved per tenant from its integrations. */
export interface ClientRequestMail {
  send(ctx: TenantContext, message: { to: string; subject: string; text: string }): Promise<void>;
}

/** Where a request's link points and whose name the email carries. */
export interface ClientRequestLinks {
  url(ctx: TenantContext, requestId: string): Promise<{ url: string; brand: string }>;
}
