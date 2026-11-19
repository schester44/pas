import type { ChannelKind, ObligationKind } from "@pas/decisions-engine";
import {
  jurisdiction,
  jurisdictionTimeZone,
  parsePlainDate,
  type TenantContext,
} from "@pas/kernel";
import { lateFrom } from "../domain/due-date";
import { Obligation, type ResponsibleParty } from "../domain/obligation";
import { type ComplianceDeps, persist } from "./deps";

export interface TrackObligationInput {
  dedupeKey: string;
  kind: ObligationKind;
  code: string;
  title: string;
  jurisdiction: { country: string; subdivision?: string };
  responsible: Pick<ResponsibleParty, "type" | "name">;
  channel: ChannelKind;
  subject: {
    policyId: string | null;
    policyNumber: string | null;
    termId: string | null;
    transactionId: string | null;
    transactionType: string | null;
  };
  dueDate: string;
  data: Record<string, unknown>;
  source: string;
}

/**
 * Obligations another context fulfils itself (an AMS download, a carrier feed): it opens one when
 * the duty arises and settles it with its delivery reference, so the compliance dashboard shows
 * them next to filings. Both steps are idempotent on the dedupe key.
 */
export function makeTrackObligations(deps: ComplianceDeps) {
  return {
    async open(ctx: TenantContext, input: TrackObligationInput): Promise<{ obligationId: string }> {
      const where = jurisdiction(input.jurisdiction.country, input.jurisdiction.subdivision);
      const dueDate = parsePlainDate(input.dueDate);

      return deps.uow.run(ctx, async (tx) => {
        const existing = await deps.obligations.findByDedupeKey(tx, ctx, input.dedupeKey);

        if (existing) return { obligationId: existing.id };

        const obligation = Obligation.create(
          {
            tenantId: ctx.tenantId,
            dedupeKey: input.dedupeKey,
            kind: input.kind,
            code: input.code,
            title: input.title,
            jurisdiction: where,
            subject: { type: "transaction", ...input.subject, periodStart: null, periodEnd: null },
            responsible: { ...input.responsible, licensee: null },
            channel: input.channel,
            rule: { days: 0, from: "issue", businessDays: false, holidays: [] },
            timer: { remindDays: null, escalateDays: null },
            dueDate,
            lateFrom: lateFrom(dueDate, jurisdictionTimeZone(where)),
            data: input.data,
            source: { releaseId: null, decision: input.source },
          },
          deps.clocks.forTenant(ctx.tenantId),
        );

        await persist(deps, tx, obligation);

        return { obligationId: obligation.id };
      });
    },

    async settle(
      ctx: TenantContext,
      input: { dedupeKey: string; providerId: string; reference: string; actor: string },
    ): Promise<void> {
      const clock = deps.clocks.forTenant(ctx.tenantId);
      const actor = { type: "channel" as const, name: input.actor };

      await deps.uow.run(ctx, async (tx) => {
        const obligation = await deps.obligations.findByDedupeKey(tx, ctx, input.dedupeKey);

        if (!obligation || obligation.status === "completed" || obligation.status === "waived") {
          return;
        }

        if (obligation.status !== "submitted" && obligation.status !== "accepted") {
          obligation.recordSubmission(
            { providerId: input.providerId, delivery: "api", reference: input.reference, actor },
            clock,
          );
        }

        const filing = obligation.latestFiling!;

        if (obligation.status === "submitted") {
          obligation.accept(
            filing.id,
            { filingNumber: input.reference, stampNumber: null, actor },
            clock,
          );
        }

        obligation.complete({ actor, summary: `Delivered as ${input.reference}` }, clock);

        await persist(deps, tx, obligation);
      });
    },
  };
}

export type TrackObligations = ReturnType<typeof makeTrackObligations>;
