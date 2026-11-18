import {
  conflict,
  type Instant,
  newId,
  type TenantContext,
  type UnitOfWork,
  type Outbox,
} from "@pas/kernel";
import type { SandboxTimers, TenantClockControl, UpcomingTimer } from "../ports/sandbox";
import type {
  FiredTimer,
  TenantEnvironmentRepository,
} from "../ports/tenant-environment-repository";

const MAX_STEPS = 200;

export interface UpcomingTimerDto {
  runId: string;
  workflowId: string;
  dueAt: string;
  label: string;
  reference: string | null;
}

export interface AdvancePreviewDto {
  now: string;
  to: string | null;
  timers: UpcomingTimerDto[];
}

export interface AdvanceResultDto {
  from: string;
  to: string;
  fired: FiredTimer[];
}

const toDto = (t: UpcomingTimer): UpcomingTimerDto => ({
  runId: t.runId,
  workflowId: t.workflowId,
  dueAt: t.dueAt.toString(),
  label: t.label,
  reference: t.reference,
});

/** Sandbox time travel: steps the clock from timer to timer so each fires in order (PLAN §15.4). */
export function makeSandboxTime(deps: {
  uow: UnitOfWork;
  outbox: Outbox;
  environments: TenantEnvironmentRepository;
  timers: SandboxTimers;
  clocks: TenantClockControl;
}) {
  const sandbox = (ctx: TenantContext) =>
    deps.uow.run(ctx, async (tx) => {
      const environment = await deps.environments.find(tx, ctx);

      if (!environment?.isSandbox) throw conflict("Time travel is only available in a sandbox.");

      return environment;
    });

  const travelTo = async (ctx: TenantContext, target: Instant) => {
    await deps.uow.run(ctx, async (tx) => {
      const environment = await deps.environments.find(tx, ctx);

      if (!environment) throw conflict("Time travel is only available in a sandbox.");

      environment.travelTo(target, deps.clocks.wall.now());
      await deps.environments.save(tx, environment);
    });

    await deps.clocks.refresh(ctx.tenantId);
  };

  const now = (ctx: TenantContext) => deps.clocks.forTenant(ctx.tenantId).now();

  return {
    async preview(ctx: TenantContext, input: { to: Instant | null }): Promise<AdvancePreviewDto> {
      await sandbox(ctx);

      const timers = await deps.timers.upcoming(
        ctx,
        input.to ? { until: input.to } : { limit: 20 },
      );

      return {
        now: now(ctx).toString(),
        to: input.to?.toString() ?? null,
        timers: timers.map(toDto),
      };
    },

    async history(ctx: TenantContext) {
      await sandbox(ctx);

      const advances = await deps.uow.run(ctx, (tx) => deps.environments.advances(tx, ctx, 20));

      return advances.map((a) => ({
        id: a.id,
        from: a.from.toString(),
        to: a.to.toString(),
        fired: a.fired,
        createdAt: a.createdAt.toString(),
      }));
    },

    async advance(ctx: TenantContext, input: { to: Instant }): Promise<AdvanceResultDto> {
      await sandbox(ctx);

      const from = now(ctx);

      if (Temporal.Instant.compare(input.to, from) <= 0) {
        throw conflict("Sandbox time only moves forward. Pick a later date.");
      }

      const fired: FiredTimer[] = [];
      const seen = new Set<string>();

      for (let step = 0; step < MAX_STEPS; step++) {
        const due = (await deps.timers.upcoming(ctx, { until: input.to })).filter(
          (t) => !seen.has(`${t.runId}:${t.stepId}`),
        );

        const next = due[0];

        if (!next) break;

        const current = now(ctx);
        const target = Temporal.Instant.compare(next.dueAt, current) > 0 ? next.dueAt : current;
        const batch = due.filter((t) => Temporal.Instant.compare(t.dueAt, target) <= 0);

        await travelTo(ctx, target);
        await deps.timers.release(ctx);
        await deps.timers.settle(ctx);

        for (const timer of batch) {
          seen.add(`${timer.runId}:${timer.stepId}`);

          fired.push({
            dueAt: timer.dueAt.toString(),
            workflowId: timer.workflowId,
            label: timer.label,
            reference: timer.reference,
            outcome: await deps.timers.outcome(ctx, timer.runId),
          });
        }
      }

      await travelTo(ctx, input.to);
      await deps.timers.release(ctx);

      await deps.uow.run(ctx, async (tx) => {
        const environment = await deps.environments.find(tx, ctx);

        if (!environment) return;

        environment.recordAdvance(from, input.to, fired.length);

        await deps.environments.recordAdvance(tx, ctx, {
          id: newId(),
          from,
          to: input.to,
          actor: ctx.actor,
          fired,
          createdAt: deps.clocks.wall.now(),
        });

        await deps.outbox.add(tx, environment.pullEvents());
      });

      return { from: from.toString(), to: input.to.toString(), fired };
    },
  };
}

export type SandboxTime = ReturnType<typeof makeSandboxTime>;
