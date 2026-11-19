import { invalid, type TenantContext } from "@pas/kernel";
import { clockOf, loadReferral, persist, personOf, type UnderwritingDeps } from "./deps";

const message = (text: string) => {
  const trimmed = text.trim();

  if (!trimmed) throw invalid("Write a message first", { field: "message" });

  return trimmed;
};

/** The underwriter asks the producer for information; the referral waits on them. */
export function makeRequestInfo(deps: UnderwritingDeps) {
  return async function requestInfo(
    ctx: TenantContext,
    input: { id: string; message: string; actorName: string },
  ) {
    const by = personOf(ctx, input.actorName);

    await deps.uow.run(ctx, async (tx) => {
      const referral = await loadReferral(deps, tx, ctx, input.id);
      const body = message(input.message);

      referral.requestInfo(body, by, clockOf(deps, ctx));
      await persist(deps, tx, referral);

      await deps.timeline.record(tx, ctx, {
        quoteId: referral.toSnapshot().quoteId,
        policyId: null,
        type: "uw_info_requested",
        actor: { type: "user", ...(by.id && { id: by.id }), name: by.name },
        summary: `${by.name} asked for information: ${body}`,
        data: { referralId: referral.id },
      });
    });
  };
}

/** The producer answers from the agent app; an answer to a request returns it to the queue. */
export function makeReplyToReferral(deps: UnderwritingDeps) {
  return async function replyToReferral(
    ctx: TenantContext,
    input: { quoteId: string; message: string; actorName: string },
  ) {
    const by = personOf(ctx, input.actorName);

    await deps.uow.run(ctx, async (tx) => {
      const referral = await deps.referrals.findOpenByQuote(tx, ctx, input.quoteId);

      if (!referral) throw invalid("This quote isn't with an underwriter");

      const answering = referral.status === "info_requested";
      const body = message(input.message);

      referral.reply(body, by, clockOf(deps, ctx));
      await persist(deps, tx, referral);

      if (answering) {
        await deps.timeline.record(tx, ctx, {
          quoteId: input.quoteId,
          policyId: null,
          type: "uw_info_provided",
          actor: { type: "user", ...(by.id && { id: by.id }), name: by.name },
          summary: `${by.name} answered the underwriter`,
          data: { referralId: referral.id },
        });
      }
    });
  };
}

/** An internal note on the referral; producers never see it. */
export function makeNoteReferral(deps: UnderwritingDeps) {
  return async function noteReferral(
    ctx: TenantContext,
    input: { id: string; message: string; actorName: string },
  ) {
    await deps.uow.run(ctx, async (tx) => {
      const referral = await loadReferral(deps, tx, ctx, input.id);

      referral.note(message(input.message), personOf(ctx, input.actorName), clockOf(deps, ctx));
      await persist(deps, tx, referral);
    });
  };
}
