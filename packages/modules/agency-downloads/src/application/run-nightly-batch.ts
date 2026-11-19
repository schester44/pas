import { parsePlainDate, type TenantContext } from "@pas/kernel";
import { selectForBatch } from "../domain/selection";
import { nextBatchDate, runInstant, statementPeriods } from "../domain/schedule";
import type { AgencyDownloadsDeps } from "./deps";
import { buildFile, deliverFile } from "./deliver";
import { ensureStatementItem } from "./send-commission-statement";
import { nightlyBatchWorkflow } from "./workflows";

const scheduledPrefix = (runDate: string) => `scheduled:${runDate}:`;

/** The nightly batch: its timer, the run itself and booking the next night. */
export function makeNightlyBatch(deps: AgencyDownloadsDeps) {
  /** Books a night's batch: the given one, the one after `after`, or the next one due. */
  async function schedule(ctx: TenantContext, input: { runDate?: string; after?: string } = {}) {
    const channel = await deps.channels.active(ctx);

    if (!channel) return null;

    const pending = await deps.uow.run(ctx, (tx) =>
      deps.items.list(tx, ctx, { status: "pending", limit: 1 }),
    );

    const runDate =
      input.runDate ??
      nextBatchDate({
        after: input.after ? parsePlainDate(input.after) : null,
        now: deps.clocks.forTenant(ctx.tenantId).now(),
        schedule: channel.settings,
        pending: pending.length > 0,
        statements: channel.settings.commissionStatements,
      })?.toString();

    if (!runDate) return null;

    await deps
      .workflows()
      .start(
        ctx,
        nightlyBatchWorkflow,
        { runDate },
        { idempotencyKey: `${nightlyBatchWorkflow.id}:${runDate}` },
      );

    return runDate;
  }

  return {
    schedule,

    /** Milliseconds of tenant time until the batch; 0 when downloads were switched off since. */
    async msUntil(ctx: TenantContext, input: { runDate: string }): Promise<number> {
      const channel = await deps.channels.active(ctx);

      if (!channel) return 0;

      const at = runInstant(parsePlainDate(input.runDate), channel.settings);
      const now = deps.clocks.forTenant(ctx.tenantId).now();

      return Math.max(0, at.epochMilliseconds - now.epochMilliseconds);
    },

    async run(ctx: TenantContext, input: { runDate: string }) {
      const channel = await deps.channels.active(ctx);

      if (!channel) return { status: "disabled" as const, delivered: 0, failed: 0, next: null };

      const { settings } = channel;
      const enrollments = await deps.uow.run(ctx, (tx) => deps.enrollments.list(tx, ctx));
      const runDate = parsePlainDate(input.runDate);

      // Every month since enrollment, so a skipped or broken night never loses a statement.
      for (const enrollment of settings.commissionStatements ? enrollments : []) {
        if (!enrollment.enabled) continue;

        for (const period of statementPeriods(enrollment.startDate, runDate)) {
          await ensureStatementItem(deps, ctx, {
            enrollment,
            from: period.from.toString(),
            to: period.to.toString(),
          });
        }
      }

      const { items, batches } = await deps.uow.run(ctx, async (tx) => ({
        items: await deps.items.list(tx, ctx, { status: "pending" }),
        batches: await deps.batches.list(tx, ctx, {
          runKeyPrefix: scheduledPrefix(input.runDate),
        }),
      }));

      const delivered = new Set(
        batches
          .filter((b) => b.status === "delivered")
          .map((b) => b.runKey.slice(scheduledPrefix(input.runDate).length)),
      );

      const groups = selectForBatch({
        items,
        enrollments,
        kinds: settings.transactionKinds,
        delivered,
      });

      let sent = 0;
      let failed = 0;

      for (const group of groups) {
        const file = await buildFile(deps, ctx, channel, group);

        const batch = await deliverFile(deps, ctx, channel, {
          ...group,
          file,
          trigger: "scheduled",
          runKey: `${scheduledPrefix(input.runDate)}${group.key}`,
        });

        if (batch.status === "delivered") sent++;
        else failed++;
      }

      return {
        status: "ran" as const,
        delivered: sent,
        failed,
        next: input.runDate,
      };
    },
  };
}

export type NightlyBatch = ReturnType<typeof makeNightlyBatch>;
