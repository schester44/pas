import { asId } from "@pas/kernel";
import { describe, expect, it } from "vitest";
import type { Enrollment } from "./enrollment";
import type { DownloadItem } from "./item";
import { selectForBatch } from "./selection";

const at = (minute: number) =>
  Temporal.Instant.from(`2027-03-01T10:${String(minute).padStart(2, "0")}:00Z`);

const enrollment = (agencyId: string, enabled = true): Enrollment => ({
  id: `enrollment-${agencyId}`,
  tenantId: asId("tenant"),
  agencyId,
  accountCode: "YAB1D",
  mailbox: null,
  agencyCodes: [{ carrier: "", code: "A1" }],
  enabled,
  startDate: Temporal.PlainDate.from("2027-01-01"),
  createdAt: at(0),
  updatedAt: at(0),
});

const item = (
  id: string,
  agencyId: string,
  type: string,
  minute: number,
  extra: Partial<DownloadItem> = {},
): DownloadItem => ({
  id,
  tenantId: asId("tenant"),
  agencyId,
  kind: "policy",
  dedupeKey: `transaction:${id}`,
  status: "pending",
  policyId: "policy",
  policyNumber: "P-1",
  transactionId: id,
  transactionType: type,
  effectiveDate: null,
  title: id,
  record: {} as DownloadItem["record"],
  batchId: null,
  attempts: 0,
  lastError: null,
  obligationId: null,
  createdAt: at(minute),
  deliveredAt: null,
  ...extra,
});

describe("selectForBatch", () => {
  const enrollments = [enrollment("enrolled"), enrollment("paused", false)];

  it("sends only enrolled agencies' pending items of the kinds the tenant sends, oldest first", () => {
    const groups = selectForBatch({
      enrollments,
      kinds: ["new_business", "cancellation"],
      delivered: new Set(),
      items: [
        item("cancel", "enrolled", "CANCELLATION", 3),
        item("nb", "enrolled", "NEW_BUSINESS", 1),
        item("endorse", "enrolled", "ENDORSEMENT", 2),
        item("paused-nb", "paused", "NEW_BUSINESS", 1),
        item("not-enrolled", "other", "NEW_BUSINESS", 1),
        item("sent", "enrolled", "NEW_BUSINESS", 0, { status: "delivered", batchId: "b1" }),
      ],
    });

    expect(groups.map((g) => [g.agencyId, g.items.map((i) => i.id)])).toEqual([
      ["enrolled", ["nb", "cancel"]],
    ]);
  });

  it("never sends the same transaction twice, nor a group a retried run already delivered", () => {
    const items = [
      item("nb", "enrolled", "NEW_BUSINESS", 1),
      item("nb-copy", "enrolled", "NEW_BUSINESS", 2, { dedupeKey: "transaction:nb" }),
      item("statement", "enrolled", "", 3, { kind: "commission_statement", transactionType: null }),
      item("statement-2", "enrolled", "", 4, {
        kind: "commission_statement",
        transactionType: null,
      }),
    ];

    const first = selectForBatch({
      items,
      enrollments,
      kinds: ["new_business"],
      delivered: new Set(),
    });

    expect(first.map((g) => [g.kind, g.items.map((i) => i.id)])).toEqual([
      ["policy", ["nb"]],
      ["commission_statement", ["statement"]],
      ["commission_statement", ["statement-2"]],
    ]);

    const retry = selectForBatch({
      items,
      enrollments,
      kinds: ["new_business"],
      delivered: new Set([first[0]!.key, first[1]!.key]),
    });

    expect(retry.map((g) => g.items[0]!.id)).toEqual(["statement-2"]);
  });
});
