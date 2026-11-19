import type { TenantContext, Transaction } from "@pas/kernel";

export type UnderwritingTimelineType =
  | "uw_info_requested"
  | "uw_info_provided"
  | "uw_escalated"
  | "subjectivity_added"
  | "subjectivity_cleared"
  | "subjectivity_overdue"
  | "inspection_ordered"
  | "inspection_scheduled"
  | "inspection_completed"
  | "inspection_reviewed"
  | "inspection_cancelled";

/**
 * The quote's history before bind, the policy's timeline after; both live in other contexts and
 * are written in the caller's transaction.
 */
export interface UnderwritingTimeline {
  record(
    tx: Transaction,
    ctx: TenantContext,
    input: {
      quoteId: string;
      policyId: string | null;
      type: UnderwritingTimelineType;
      actor: { type: "user" | "system"; id?: string; name: string };
      summary: string;
      data: Record<string, unknown>;
    },
  ): Promise<void>;
}
