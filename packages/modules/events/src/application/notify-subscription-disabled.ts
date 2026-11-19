import type { AdminLinks, AdminMailer, TenantMembers } from "../ports/platform";
import { systemContext } from "./deps";

/** Emails the tenant's admins when a destination was switched off after a day of failures. */
export function makeNotifySubscriptionDisabled(deps: {
  members: TenantMembers;
  mailer: AdminMailer;
  links: AdminLinks & { settings(path: string): string };
}) {
  return async function notifySubscriptionDisabled(input: {
    tenantId: string;
    subscriptionId: string;
    name: string;
    kind: string;
  }): Promise<string[]> {
    const ctx = systemContext(input.tenantId);
    const admins = (await deps.members.list(ctx)).filter((m) => m.admin && m.email);
    const noun = input.kind === "webhook" ? "webhook endpoint" : "Slack destination";

    const url = deps.links.settings(
      input.kind === "webhook"
        ? `/settings/developers/webhooks/${input.subscriptionId}`
        : "/settings/notifications",
    );

    for (const admin of admins) {
      await deps.mailer.send(ctx, {
        to: admin.email,
        tag: "event_subscription_disabled",
        subject: `We turned off the ${noun} "${input.name}"`,
        text: `Every delivery to the ${noun} "${input.name}" failed for 24 hours, so we stopped sending to it. Events from now on aren't queued for it.\n\nFix the destination, turn it back on and replay any deliveries you need: ${url}`,
      });
    }

    return admins.map((a) => a.email);
  };
}
