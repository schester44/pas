import { newId, notFound, parsePlainDate, type TenantContext } from "@pas/kernel";
import { agencyCodeFor, type Enrollment } from "../domain/enrollment";
import { type DownloadItem, statementItemKey } from "../domain/item";
import type { CommissionStatementRecord } from "../domain/statement";
import type { AgencyDownloadChannel } from "../ports/channel";
import type { AgencyDownloadsDeps } from "./deps";
import { buildFile, deliverFile } from "./deliver";

const monthLabel = (from: string) =>
  parsePlainDate(from).toLocaleString("en-US", { month: "short", year: "numeric" });

/** The agency's commission statement for a period as a pending item; one per agency and period. */
export async function ensureStatementItem(
  deps: AgencyDownloadsDeps,
  ctx: TenantContext,
  input: { enrollment: Enrollment; from: string; to: string },
): Promise<DownloadItem> {
  const key = statementItemKey(input.enrollment.agencyId, parsePlainDate(input.from));
  const existing = await deps.uow.run(ctx, (tx) => deps.items.findByDedupeKey(tx, ctx, key));

  if (existing) return existing;

  const statement = await deps.agencies.statement(ctx, {
    agencyId: input.enrollment.agencyId,
    from: input.from,
    to: input.to,
  });

  const { agencyName, ...rest } = statement;

  const record: CommissionStatementRecord = {
    version: 1,
    agency: {
      id: input.enrollment.agencyId,
      name: agencyName,
      code: agencyCodeFor(input.enrollment),
      accountCode: input.enrollment.accountCode,
    },
    ...rest,
  };

  const item: DownloadItem = {
    id: newId(),
    tenantId: ctx.tenantId,
    agencyId: input.enrollment.agencyId,
    kind: "commission_statement",
    dedupeKey: key,
    status: "pending",
    policyId: null,
    policyNumber: null,
    transactionId: null,
    transactionType: null,
    effectiveDate: parsePlainDate(input.to),
    title: `Commission statement ${monthLabel(input.from)}`,
    record,
    batchId: null,
    attempts: 0,
    lastError: null,
    obligationId: null,
    createdAt: deps.clocks.forTenant(ctx.tenantId).now(),
    deliveredAt: null,
  };

  await deps.uow.run(ctx, (tx) => deps.items.save(tx, item));

  return item;
}

export async function activeChannel(
  deps: Pick<AgencyDownloadsDeps, "channels">,
  ctx: TenantContext,
): Promise<AgencyDownloadChannel> {
  const channel = await deps.channels.active(ctx);

  if (!channel) throw notFound("Enabled agency downloads provider", "agency_downloads");

  return channel;
}

/** Sends an agency's commission statement for a period now, outside the nightly batch. */
export function makeSendCommissionStatement(deps: AgencyDownloadsDeps) {
  return async function sendCommissionStatement(
    ctx: TenantContext,
    input: { agencyId: string; from: string; to: string },
  ) {
    const channel = await activeChannel(deps, ctx);

    const enrollment = await deps.uow.run(ctx, (tx) =>
      deps.enrollments.findByAgency(tx, ctx, input.agencyId),
    );

    if (!enrollment) throw notFound("Agency download enrollment", input.agencyId);

    const item = await ensureStatementItem(deps, ctx, { enrollment, ...input });
    const group = { kind: "commission_statement" as const, enrollment, items: [item] };
    const file = await buildFile(deps, ctx, channel, group);

    const batch = await deliverFile(deps, ctx, channel, {
      ...group,
      agencyId: input.agencyId,
      file,
      trigger: "manual",
      runKey: null,
    });

    return { batchId: batch.id, status: batch.status, error: batch.error };
  };
}
