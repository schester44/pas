import { newId, type TenantContext } from "@pas/kernel";
import type { LetterRequest } from "../ports/adapters";
import type { MailPieces, MailReference } from "../ports/mail-pieces";
import { clockOf, type IntegrationDeps } from "./deps";

/** Sends a letter through the tenant's print & mail provider and starts tracking it. */
export function makeSendLetter(deps: IntegrationDeps & { mail: MailPieces }) {
  return async function sendLetter(
    ctx: TenantContext,
    input: { reference: MailReference; letter: LetterRequest },
  ): Promise<{ mailPieceId: string; providerId: string; providerRef: string }> {
    const provider = await deps.resolver.primary(ctx, "print_mail");
    const receipt = await provider.adapter.sendLetter(input.letter);
    const clock = clockOf(deps, ctx);
    const id = newId();

    await deps.uow.run(ctx, async (tx) => {
      await deps.mail.save(tx, ctx, {
        id,
        installId: provider.installId,
        providerId: provider.providerId,
        providerRef: receipt.providerRef,
        reference: input.reference,
        mailType: input.letter.mailType,
        status: receipt.status,
        trackingNumber: receipt.trackingNumber,
        tracking: [],
        proof: null,
        createdAt: clock.now(),
        updatedAt: clock.now(),
      });

      await deps.events.add(tx, ctx, {
        id: newId(),
        installId: provider.installId,
        providerId: provider.providerId,
        kind: "delivery",
        outcome: "ok",
        summary: `Letter ${receipt.providerRef} sent ${input.letter.mailType.replaceAll("_", " ")}`,
        externalId: null,
        data: { reference: input.reference, expectedDeliveryDate: receipt.expectedDeliveryDate },
        occurredAt: clock.now(),
      });
    });

    return { mailPieceId: id, providerId: provider.providerId, providerRef: receipt.providerRef };
  };
}

export type SendLetter = ReturnType<typeof makeSendLetter>;
