import type { Enrollment } from "./enrollment";
import type { DownloadItem, ItemKind } from "./item";
import { type TransactionKind, transactionKindOf } from "./settings";

export interface BatchSelection {
  /** One file per agency mailbox and kind; each commission statement is a file of its own. */
  key: string;
  agencyId: string;
  kind: ItemKind;
  enrollment: Enrollment;
  items: DownloadItem[];
}

/**
 * What tonight's batch sends, one group per agency mailbox and kind: pending items of enrolled
 * agencies, of transaction kinds the tenant sends, each once. Groups whose batch already went out
 * for this run (a retried run) are skipped.
 */
export function selectForBatch(input: {
  items: readonly DownloadItem[];
  enrollments: readonly Enrollment[];
  kinds: readonly TransactionKind[];
  delivered: ReadonlySet<string>;
}): BatchSelection[] {
  const enrollments = new Map(
    input.enrollments.filter((e) => e.enabled).map((e) => [e.agencyId, e]),
  );

  const seen = new Set<string>();
  const groups = new Map<string, BatchSelection>();

  const ordered = input.items.toSorted((a, b) =>
    Temporal.Instant.compare(a.createdAt, b.createdAt),
  );

  for (const item of ordered) {
    const enrollment = enrollments.get(item.agencyId);

    if (item.status !== "pending" || !enrollment || seen.has(item.dedupeKey)) continue;

    if (item.kind === "policy") {
      const kind = item.transactionType ? transactionKindOf(item.transactionType) : null;

      if (!kind || !input.kinds.includes(kind)) continue;
    }

    const key = groupKey(item);

    if (input.delivered.has(key)) continue;

    seen.add(item.dedupeKey);

    const group = groups.get(key) ?? {
      key,
      agencyId: item.agencyId,
      kind: item.kind,
      enrollment,
      items: [],
    };

    group.items.push(item);
    groups.set(key, group);
  }

  return [...groups.values()];
}

export const groupKey = (item: Pick<DownloadItem, "agencyId" | "kind" | "dedupeKey">) =>
  item.kind === "commission_statement"
    ? `${item.agencyId}:${item.kind}:${item.dedupeKey}`
    : `${item.agencyId}:${item.kind}`;
