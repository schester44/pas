import { jurisdictionTimeZone, type TenantContext } from "@pas/kernel";
import type { ObligationId } from "../domain/obligation";
import { type ComplianceDeps, loadObligation, persist, recordOnPolicy } from "./deps";
import { filingRequestOf } from "./dto";
import { applyResult } from "./filing-results";

export interface ObligationStep {
  id: "remind" | "overdue" | "escalate";
  level: 1 | 2 | 3;
  at: string;
}

const MAX_POLLS = 30;

/** What the compliance workflows read and do on their timers. */
export function makeObligationTimers(deps: ComplianceDeps) {
  const now = (ctx: TenantContext) => deps.clocks.forTenant(ctx.tenantId).now();

  const load = (ctx: TenantContext, id: string) =>
    deps.uow.run(ctx, (tx) => loadObligation(deps, tx, ctx, id));

  return {
    async steps(ctx: TenantContext, input: { obligationId: string }): Promise<ObligationStep[]> {
      const s = (await load(ctx, input.obligationId)).toSnapshot();
      const zone = jurisdictionTimeZone(s.jurisdiction);
      const steps: ObligationStep[] = [];

      if (s.timer.remindDays !== null) {
        const remindOn = s.dueDate.subtract({ days: s.timer.remindDays });

        steps.push({
          id: "remind",
          level: 1,
          at: remindOn.toZonedDateTime({ timeZone: zone }).toInstant().toString(),
        });
      }

      steps.push({ id: "overdue", level: 2, at: s.lateFrom.toString() });

      if (s.timer.escalateDays !== null) {
        const escalateOn = s.dueDate.add({ days: s.timer.escalateDays + 1 });

        steps.push({
          id: "escalate",
          level: 3,
          at: escalateOn.toZonedDateTime({ timeZone: zone }).toInstant().toString(),
        });
      }

      return steps;
    },

    msUntil(ctx: TenantContext, at: string): number {
      return Math.max(0, now(ctx).until(Temporal.Instant.from(at)).total("milliseconds"));
    },

    async fire(ctx: TenantContext, input: { obligationId: string; step: ObligationStep }) {
      return deps.uow.run(ctx, async (tx) => {
        const obligation = await loadObligation(deps, tx, ctx, input.obligationId);

        if (!obligation.isOpen) return { done: true, status: obligation.status };

        if (obligation.escalate(input.step.level, deps.clocks.forTenant(ctx.tenantId))) {
          if (input.step.level === 2)
            await recordOnPolicy(deps, tx, ctx, obligation, "obligation_overdue");

          await persist(deps, tx, obligation);
        }

        return { done: false, status: input.step.level >= 2 ? "overdue" : obligation.status };
      });
    },

    async describe(ctx: TenantContext, input: { obligationId: string }) {
      const obligation = await deps.uow.run(ctx, (tx) =>
        deps.obligations.findById(tx, ctx, input.obligationId as ObligationId),
      );

      const s = obligation?.toSnapshot();

      return s
        ? {
            title: s.title,
            reference:
              s.subject.policyNumber ?? `${s.jurisdiction.subdivision} ${s.subject.periodStart}`,
          }
        : null;
    },

    async pollAfterSeconds(
      ctx: TenantContext,
      input: { obligationId: string; filingId: string },
    ): Promise<number | null> {
      const obligation = await load(ctx, input.obligationId);
      const filing = obligation.filing(input.filingId);

      if (filing.status !== "submitted" || filing.delivery !== "api") return null;

      const channel = await deps.channels.byProvider(ctx, filing.providerId);

      return channel?.poll ? (channel.pollAfterSeconds ?? 60) : null;
    },

    /** Asks the channel once; true when the filing has its answer (or can't get one). */
    async poll(
      ctx: TenantContext,
      input: { obligationId: string; filingId: string; attempt: number },
    ): Promise<boolean> {
      const obligation = await load(ctx, input.obligationId);
      const filing = obligation.filing(input.filingId);

      if (filing.status !== "submitted" || !filing.reference) return true;

      const channel = await deps.channels.byProvider(ctx, filing.providerId);

      if (!channel?.poll) return true;

      const outcome = await channel.poll(ctx, {
        reference: filing.reference,
        request: filingRequestOf(obligation),
        submittedAt: filing.submittedAt.toString(),
      });

      if (outcome.status === "pending") return input.attempt >= MAX_POLLS;

      return deps.uow.run(ctx, async (tx) => {
        const current = await loadObligation(deps, tx, ctx, input.obligationId);

        const settled = await applyResult(
          deps,
          tx,
          ctx,
          current,
          input.filingId,
          outcome,
          channel.name,
        );

        await persist(deps, tx, current);

        return settled;
      });
    },
  };
}

export type ObligationTimers = ReturnType<typeof makeObligationTimers>;
