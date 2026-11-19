import { DomainError, newId, notFound, type TenantContext, type Transaction } from "@pas/kernel";
import type { MailPieces, NoticeProofs } from "../ports/mail-pieces";
import type { InboundWebhook, WebhookEvent } from "../ports/provider-catalog";
import { clockOf, type IntegrationDeps, packageOf } from "./deps";

type Deps = IntegrationDeps & { mail: MailPieces; notices: NoticeProofs };

/**
 * A provider's webhook for one install: verify its signature, then record each event once
 * (keyed by the provider's event id). Mail tracking updates the piece and its notice's proof.
 */
export function makeHandleWebhook(deps: Deps) {
  return async function handleWebhook(
    input: { kind: string; installId: string } & InboundWebhook,
  ): Promise<{ received: number }> {
    const tenantId = await deps.installs.tenantOf(input.installId);

    if (!tenantId) throw notFound("Integration", input.installId);

    const ctx: TenantContext = { tenantId, actor: { type: "system", process: "webhooks" } };

    const install = await deps.uow.run(ctx, (tx) =>
      deps.installs.findById(tx, ctx, input.installId),
    );

    if (!install) throw notFound("Integration", input.installId);

    const pkg = packageOf(deps, install.providerId);

    if (!pkg.webhook || pkg.manifest.webhook?.kind !== input.kind) {
      throw notFound("Webhook", input.kind);
    }

    let events: WebhookEvent[];

    try {
      events = await pkg.webhook(input, deps.resolver.settings(install.toSnapshot()));
    } catch (error) {
      throw new DomainError("forbidden", `Webhook rejected: ${(error as Error).message}`);
    }

    const clock = clockOf(deps, ctx);

    await deps.uow.run(ctx, async (tx) => {
      for (const event of events) {
        const fresh = await deps.events.add(tx, ctx, {
          id: newId(),
          installId: install.id,
          providerId: install.providerId,
          kind: "webhook",
          outcome: "ok",
          summary: event.summary,
          externalId: event.externalId,
          data: "data" in event ? event.data : {},
          occurredAt: clock.now(),
        });

        if (!fresh) continue;

        if (event.kind === "mail_tracking") await track(deps, tx, ctx, install.providerId, event);

        if (event.kind === "billing") {
          await deps.outbox.add(tx, [
            {
              id: newId(),
              type: "integrations.billing_event_received",
              tenantId,
              aggregateType: "integration_install",
              aggregateId: install.id,
              occurredAt: clock.now(),
              payload: { installId: install.id, event: event.data },
            },
          ]);
        }

        if (event.kind === "payment") {
          await deps.outbox.add(tx, [
            {
              id: newId(),
              type: "integrations.payment_event_received",
              tenantId,
              aggregateType: "integration_install",
              aggregateId: install.id,
              occurredAt: clock.now(),
              payload: {
                providerId: install.providerId,
                type: event.type,
                paymentRef: event.paymentRef,
              },
            },
          ]);
        }
      }
    });

    return { received: events.length };
  };
}

async function track(
  deps: Deps,
  tx: Transaction,
  ctx: TenantContext,
  providerId: string,
  event: Extract<WebhookEvent, { kind: "mail_tracking" }>,
): Promise<void> {
  const piece = await deps.mail.find(tx, ctx, providerId, event.providerRef);

  if (!piece) return;

  const proof =
    event.proofOfMailing && !piece.proof
      ? {
          providerId,
          providerRef: piece.providerRef,
          mailType: piece.mailType,
          trackingNumber: event.trackingNumber ?? piece.trackingNumber,
          mailedAt: event.occurredAt.toString(),
          eventId: event.externalId,
        }
      : piece.proof;

  await deps.mail.save(tx, ctx, {
    ...piece,
    status: event.status,
    trackingNumber: event.trackingNumber ?? piece.trackingNumber,
    tracking: [
      ...piece.tracking,
      {
        status: event.status,
        occurredAt: event.occurredAt.toString(),
        externalId: event.externalId,
      },
    ],
    proof,
    updatedAt: deps.clocks.forTenant(ctx.tenantId).now(),
  });

  if (proof && !piece.proof && piece.reference.kind === "policy_notice") {
    const tracking = proof.trackingNumber ? `, tracking ${proof.trackingNumber}` : "";

    await deps.notices.record(tx, ctx, {
      policyId: piece.reference.policyId,
      summary: `${piece.reference.title} mailed ${proof.mailType.replaceAll("_", " ")}${tracking}`,
      data: { transactionId: piece.reference.transactionId, proofOfMailing: proof },
    });
  }
}

export type HandleWebhook = ReturnType<typeof makeHandleWebhook>;
