import { newId, type TenantContext } from "@pas/kernel";
import type { LetterRequest } from "../ports/adapters";
import type { MailPieces, MailProof, MailReference, NoticeProofs } from "../ports/mail-pieces";
import { clockOf, type IntegrationDeps } from "./deps";

/**
 * Sends a letter through the tenant's print & mail provider and starts tracking it. When the
 * provider certifies mailing at once, the proof is recorded on the notice right away.
 */
export function makeSendLetter(
  deps: IntegrationDeps & { mail: MailPieces; notices: NoticeProofs },
) {
  return async function sendLetter(
    ctx: TenantContext,
    input: { reference: MailReference; letter: LetterRequest },
  ): Promise<{
    mailPieceId: string;
    providerId: string;
    providerRef: string;
    proof: MailProof | null;
  }> {
    const provider = await deps.resolver.primary(ctx, "print_mail");
    const receipt = await provider.adapter.sendLetter(input.letter);
    const clock = clockOf(deps, ctx);
    const id = newId();
    const eventId = newId();

    const proof: MailProof | null = receipt.mailed
      ? {
          providerId: provider.providerId,
          providerRef: receipt.providerRef,
          mailType: input.letter.mailType,
          trackingNumber: receipt.trackingNumber,
          mailedAt: clock.now().toString(),
          eventId,
        }
      : null;

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
        proof,
        createdAt: clock.now(),
        updatedAt: clock.now(),
      });

      await deps.events.add(tx, ctx, {
        id: eventId,
        installId: provider.installId,
        providerId: provider.providerId,
        kind: "delivery",
        outcome: "ok",
        summary: `Letter ${receipt.providerRef} sent ${input.letter.mailType.replaceAll("_", " ")}`,
        externalId: null,
        data: { reference: input.reference, expectedDeliveryDate: receipt.expectedDeliveryDate },
        occurredAt: clock.now(),
      });

      if (proof && input.reference.kind === "policy_notice") {
        const tracking = proof.trackingNumber ? `, tracking ${proof.trackingNumber}` : "";

        await deps.notices.record(tx, ctx, {
          policyId: input.reference.policyId,
          summary: `${input.reference.title} mailed ${proof.mailType.replaceAll("_", " ")} to ${input.letter.to.name}${tracking}`,
          data: { transactionId: input.reference.transactionId, proofOfMailing: proof },
        });
      }
    });

    return {
      mailPieceId: id,
      providerId: provider.providerId,
      providerRef: receipt.providerRef,
      proof,
    };
  };
}

export type SendLetter = ReturnType<typeof makeSendLetter>;
