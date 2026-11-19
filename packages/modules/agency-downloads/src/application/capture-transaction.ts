import {
  type DomainEvent,
  newId,
  parseInstant,
  parsePlainDate,
  type TenantContext,
} from "@pas/kernel";
import { enrolledOn } from "../domain/enrollment";
import { type DownloadItem, policyItemKey } from "../domain/item";
import { reconcile, toDownloadRecord } from "../domain/record";
import { nextRunDate } from "../domain/schedule";
import { transactionKindOf } from "../domain/settings";
import { type AgencyDownloadsDeps, obligationKey } from "./deps";

const KIND_TITLE: Record<string, string> = {
  new_business: "New business",
  endorsement: "Endorsement",
  cancellation: "Cancellation",
  reinstatement: "Reinstatement",
  renewal: "Renewal",
};

export type CaptureResult =
  | { status: "queued"; itemId: string; runDate: string }
  | { status: "skipped"; reason: string };

/**
 * Queues an issued transaction for its agency's mailbox (PLAN §17.4): only when downloads are
 * enabled, the transaction kind is sent and the agency is enrolled. Idempotent per transaction.
 */
export function makeCaptureTransaction(deps: AgencyDownloadsDeps) {
  return async function captureTransaction(
    ctx: TenantContext,
    input: { policyId: string; transactionId: string },
  ): Promise<CaptureResult> {
    const channel = await deps.channels.active(ctx);

    if (!channel) return { status: "skipped", reason: "agency downloads aren't enabled" };

    const { settings } = channel;
    const view = await deps.transactions.view(ctx, input);

    if (!view) return { status: "skipped", reason: "no agency on the transaction" };

    const kind = transactionKindOf(view.transaction.type);

    if (!kind || !settings.transactionKinds.includes(kind)) {
      return { status: "skipped", reason: `${view.transaction.type} isn't sent` };
    }

    const key = policyItemKey(view.transaction.id);
    const clock = deps.clocks.forTenant(ctx.tenantId);

    const existing = await deps.uow.run(ctx, async (tx) => ({
      enrollment: await deps.enrollments.findByAgency(tx, ctx, view.agency.id),
      item: await deps.items.findByDedupeKey(tx, ctx, key),
    }));

    if (existing.item) {
      return {
        status: "queued",
        itemId: existing.item.id,
        runDate: nextRunDate(clock.now(), settings).toString(),
      };
    }

    const issuedOn = parseInstant(view.transaction.issuedAt)
      .toZonedDateTimeISO(settings.timeZone)
      .toPlainDate();

    if (!existing.enrollment || !enrolledOn(existing.enrollment, issuedOn)) {
      return { status: "skipped", reason: `${view.agency.name} isn't enrolled` };
    }

    const record = toDownloadRecord(view, { kind, enrollment: existing.enrollment, settings });
    const issues = reconcile(record, view.transaction.premium);
    const runDate = nextRunDate(clock.now(), settings);
    const title = `${KIND_TITLE[kind]} ${view.policy.number}`;

    const { obligationId } = await deps.obligations.open(ctx, {
      dedupeKey: obligationKey(key),
      title: `Agency download: ${title} to ${view.agency.name}`,
      jurisdiction: view.policy.jurisdiction,
      policy: { id: view.policy.id, number: view.policy.number, termId: null },
      transaction: { id: view.transaction.id, type: view.transaction.type },
      dueDate: runDate.toString(),
      data: {
        agencyId: view.agency.id,
        agencyName: view.agency.name,
        accountCode: existing.enrollment.accountCode,
        insuredName: view.policy.insuredName,
      },
    });

    const now = clock.now();

    const item: DownloadItem = {
      id: newId(),
      tenantId: ctx.tenantId,
      agencyId: view.agency.id,
      kind: "policy",
      dedupeKey: key,
      status: "pending",
      policyId: view.policy.id,
      policyNumber: view.policy.number,
      transactionId: view.transaction.id,
      transactionType: view.transaction.type,
      effectiveDate: parsePlainDate(view.transaction.effectiveDate),
      title,
      record,
      batchId: null,
      attempts: 0,
      lastError: issues.length > 0 ? issues.join("; ") : null,
      obligationId,
      createdAt: now,
      deliveredAt: null,
    };

    const event: DomainEvent = {
      id: newId(),
      type: "agency_downloads.item_queued",
      tenantId: ctx.tenantId,
      aggregateType: "agency_download_item",
      aggregateId: item.id,
      occurredAt: now,
      payload: { itemId: item.id, agencyId: item.agencyId, runDate: runDate.toString() },
    };

    await deps.uow.run(ctx, async (tx) => {
      await deps.items.save(tx, item);
      await deps.outbox.add(tx, [event]);
    });

    return { status: "queued", itemId: item.id, runDate: runDate.toString() };
  };
}
