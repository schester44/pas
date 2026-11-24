import type { TenantContext } from "@pas/kernel";
import type { ClientRequestLinks, ClientRequestMail } from "../ports/client-request-mail";

/** Handles `submissions.client_request_sent`: the email that brings the insured to their application. */
export function makeEmailClientRequest(deps: {
  mail: ClientRequestMail;
  links: ClientRequestLinks;
}) {
  return async function emailClientRequest(
    ctx: TenantContext,
    input: { requestId: string; email: string; name: string; sentBy: string },
  ): Promise<void> {
    const { url, brand } = await deps.links.url(ctx, input.requestId);

    await deps.mail.send(ctx, {
      to: input.email,
      subject: `${input.sentBy} sent you an insurance application to complete`,
      text: [
        `Hi ${input.name},`,
        "",
        `${input.sentBy} prepared your ${brand} application. Review it, then finish the steps that need you:`,
        url,
        "",
        "Sign in with this email address and we'll send you a one-time code.",
      ].join("\n"),
    });
  };
}

export type EmailClientRequest = ReturnType<typeof makeEmailClientRequest>;
