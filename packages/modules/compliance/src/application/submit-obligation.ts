import { DomainError, jurisdictionCode, newId, type TenantContext } from "@pas/kernel";
import type { Obligation } from "../domain/obligation";
import type { FilingChannel } from "../ports/filing-channel";
import { type ComplianceDeps, loadObligation, persist, recordOnPolicy, userActor } from "./deps";
import { filingRequestOf, type ObligationDetailDto, toDetailDto } from "./dto";
import { applyResult } from "./filing-results";

export async function channelFor(
  deps: Pick<ComplianceDeps, "channels">,
  ctx: TenantContext,
  obligation: Obligation,
  providerId?: string,
): Promise<FilingChannel> {
  const s = obligation.toSnapshot();
  const where = jurisdictionCode(s.jurisdiction);

  const channel = providerId
    ? await deps.channels.byProvider(ctx, providerId)
    : (
        await deps.channels.serving(ctx, {
          kind: s.kind,
          jurisdiction: where,
          preferred: s.channel,
        })
      )[0];

  if (!channel || !channel.serves(s.kind, where)) {
    throw new DomainError(
      "precondition_failed",
      `No enabled filing channel files ${s.title.toLowerCase()} in ${where}. Enable one in Settings → Integrations, or mark it submitted with proof.`,
      { reason: "no_channel" },
    );
  }

  return channel;
}

/** Sends one obligation through its filing channel (PLAN §17.5); file channels export a batch of one. */
export function makeSubmitObligation(
  deps: ComplianceDeps & {
    exportBatch: (
      ctx: TenantContext,
      input: { obligationIds: string[]; providerId?: string; actorName: string },
    ) => Promise<unknown>;
  },
) {
  return async function submitObligation(
    ctx: TenantContext,
    input: { obligationId: string; providerId?: string; actorName: string },
  ): Promise<ObligationDetailDto> {
    const clock = deps.clocks.forTenant(ctx.tenantId);

    const obligation = await deps.uow.run(ctx, (tx) =>
      loadObligation(deps, tx, ctx, input.obligationId),
    );

    const channel = await channelFor(deps, ctx, obligation, input.providerId);

    if (channel.delivery === "file_export") {
      await deps.exportBatch(ctx, {
        obligationIds: [input.obligationId],
        providerId: channel.provider,
        actorName: input.actorName,
      });
    } else {
      const s = obligation.toSnapshot();

      const correction =
        s.status === "corrected"
          ? (s.events.findLast((e) => e.type === "corrected")?.summary ?? null)
          : null;

      if (!obligation.isOpen) {
        throw new DomainError("conflict", "This obligation has already been submitted");
      }

      const result = await channel.submit!(ctx, filingRequestOf(obligation, correction));

      await deps.uow.run(ctx, async (tx) => {
        const current = await loadObligation(deps, tx, ctx, input.obligationId);

        const filing = current.recordSubmission(
          {
            providerId: channel.provider,
            delivery: "api",
            reference: result.reference ?? `${channel.provider}-${newId()}`,
            actor: userActor(ctx, input.actorName),
          },
          clock,
        );

        await recordOnPolicy(deps, tx, ctx, current, "filing_submitted", `via ${channel.name}`);
        await applyResult(deps, tx, ctx, current, filing.id, result, channel.name);
        await persist(deps, tx, current);
      });
    }

    return deps.uow.run(ctx, async (tx) =>
      toDetailDto(await loadObligation(deps, tx, ctx, input.obligationId), clock.now()),
    );
  };
}

export type SubmitObligation = ReturnType<typeof makeSubmitObligation>;
