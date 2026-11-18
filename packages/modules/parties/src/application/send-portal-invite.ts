import type { TenantContext } from "@pas/kernel";
import type { Mailer } from "../ports/mailer";
import type { PortalLinks } from "../ports/portal-links";

/** Handles `parties.client_invited`: the email that brings an insured to the portal. */
export function makeSendPortalInvite(deps: { mailer: Mailer; links: PortalLinks }) {
  return async function sendPortalInvite(
    ctx: TenantContext,
    input: { email: string; name: string; policyNumber: string },
  ): Promise<void> {
    const { url, brand } = await deps.links.signIn(ctx, { email: input.email });

    await deps.mailer.send({
      to: input.email,
      tag: "client_portal_invite",
      subject: `Your ${brand} policy ${input.policyNumber} is ready`,
      text: [
        `Hi ${input.name},`,
        "",
        `Your policy ${input.policyNumber} is in place. See your policies, documents and invoices, and request changes, at:`,
        url,
        "",
        `Sign in with this email address and we'll send you a one-time code.`,
      ].join("\n"),
    });
  };
}

export type SendPortalInvite = ReturnType<typeof makeSendPortalInvite>;
