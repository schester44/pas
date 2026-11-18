import type { TenantContext, Transaction } from "@pas/kernel";
import type { Submission, SubmissionId } from "../domain/submission";
import type { SubmissionScope } from "../domain/scope";

export interface SubmissionRepository {
  save(tx: Transaction, submission: Submission): Promise<void>;
  findById(
    tx: Transaction,
    ctx: TenantContext,
    scope: SubmissionScope,
    id: SubmissionId,
  ): Promise<Submission | null>;
  list(
    tx: Transaction,
    ctx: TenantContext,
    scope: SubmissionScope,
    options: { limit: number },
  ): Promise<Submission[]>;
  /** Next value of the tenant's gap-tolerant submission counter, starting at 1. */
  nextSequence(tx: Transaction, ctx: TenantContext): Promise<number>;
}
