import { addressIdsIn, addressesIn, clearanceModeFrom, type ClearanceDto } from "@pas/addresses";
import type { TenantContext, UnitOfWork } from "@pas/kernel";
import type { SubmissionScope } from "../domain/scope";
import type { AddressRegistry } from "../ports/address-registry";
import type { ProductCatalog } from "../ports/product-catalog";
import type { SubmissionRepository } from "../ports/submission-repository";
import { loadSubmission, pinnedIntake } from "./intake";

export type SubmissionClearance = ClearanceDto & { checked: number };

/**
 * Possible duplicate risks for a submission's locations. Drafts pass the locations being typed
 * (already stamped with registry ids); submitted ones use what was tracked at submit.
 */
export function makeCheckSubmissionClearance(deps: {
  uow: UnitOfWork;
  submissions: SubmissionRepository;
  catalog: ProductCatalog;
  addresses: AddressRegistry;
}) {
  return async function checkSubmissionClearance(
    ctx: TenantContext,
    scope: SubmissionScope,
    input: { id: string; riskData?: Record<string, unknown> },
  ): Promise<SubmissionClearance> {
    const submission = await deps.uow.run(ctx, (tx) =>
      loadSubmission(deps.submissions, tx, ctx, scope, input.id),
    );

    const s = submission.toSnapshot();
    const release = await deps.catalog.getRelease(ctx, s.productReleaseId);
    const intake = await pinnedIntake(deps.catalog, ctx, submission);

    const addressIds = addressesIn(intake.riskSchema, input.riskData ?? s.riskData)
      .filter((a) => a.role === "location")
      .flatMap((a) => addressIdsIn(a.value));

    const result = await deps.addresses.clearance(ctx, {
      mode: clearanceModeFrom(release.lifecycle),
      subject: { kind: "submission", id: s.id },
      producerId: s.producer.userId,
      addressIds,
    });

    return { ...result, checked: addressIds.length };
  };
}

export type CheckSubmissionClearance = ReturnType<typeof makeCheckSubmissionClearance>;
