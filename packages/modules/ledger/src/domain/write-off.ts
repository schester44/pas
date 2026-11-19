import { conflict, type Money } from "@pas/kernel";

export type WriteOffStatus = "pending_approval" | "posted" | "rejected";

/** At or under the tenant's small-balance threshold a write-off posts at once; above it, it waits. */
export function writeOffNeedsApproval(amount: Money, threshold: Money | null): boolean {
  if (!threshold || threshold.currency !== amount.currency) return true;

  return amount.amount.greaterThan(threshold.amount);
}

/** Four eyes: whoever asked for a write-off can't approve it. */
export function assertApprover(requestedById: string, approverId: string): void {
  if (requestedById === approverId) {
    throw conflict("Someone other than the requester has to approve this write-off");
  }
}
