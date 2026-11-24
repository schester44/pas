import {
  DomainError,
  invalid,
  jurisdiction,
  type Jurisdiction,
  type Outbox,
  parsePlainDate,
  type TenantContext,
  type UnitOfWork,
  type ClockProvider,
} from "@pas/kernel";
import { IntakeFormMissingError, ProductUnavailableError } from "../domain/errors";
import { Submission, type SubmissionChannel, type SubmissionStage } from "../domain/submission";
import { formatSubmissionNumber } from "../domain/submission-number";
import type { Candidate } from "../domain/quote-options";
import type { CatalogRelease, ProductCatalog } from "../ports/product-catalog";
import type { SubmissionRepository } from "../ports/submission-repository";
import { type SubmissionDto, toSubmissionDto } from "./dto";
import { intakeForm } from "./intake";

export type StartSubmissionInput = ({ offeringId: string } | { productId: string }) & {
  jurisdiction: Jurisdiction;
  effectiveDate: string;
  producerName: string;
  producerAgencyId?: string | null;
};

const CHANNEL: SubmissionChannel = "agent";
const STAGE: SubmissionStage = "quote";

/**
 * Starts intake for an offering (PLAN §6.0), pinning every member release available there. A bare
 * product starts a single-candidate submission, as if it were a one-member offering.
 */
export function makeStartSubmission(deps: {
  uow: UnitOfWork;
  outbox: Outbox;
  submissions: SubmissionRepository;
  catalog: ProductCatalog;
  clocks: ClockProvider;
}) {
  async function resolve(
    ctx: TenantContext,
    input: StartSubmissionInput,
    where: Jurisdiction,
    effectiveDate: string,
  ) {
    if ("offeringId" in input) {
      const offering = await deps.catalog.resolveOffering(ctx, {
        offeringId: input.offeringId,
        jurisdiction: where,
        effectiveDate,
      });

      return {
        name: offering.name,
        offering: offering.active ? { id: offering.id, selection: offering.selection } : null,
        releases: offering.active ? offering.releases : [],
      };
    }

    const [name, release] = await Promise.all([
      deps.catalog.productName(ctx, input.productId),
      deps.catalog.resolveNewBusiness(ctx, {
        productId: input.productId,
        jurisdiction: where,
        effectiveDate,
      }),
    ]);

    return { name, offering: null, releases: release ? [release] : [] };
  }

  return async function startSubmission(
    ctx: TenantContext,
    input: StartSubmissionInput,
  ): Promise<SubmissionDto> {
    if (ctx.actor.type !== "user") {
      throw new DomainError("forbidden", "Only a signed-in producer can start a submission");
    }

    const producer = {
      userId: ctx.actor.userId,
      name: input.producerName,
      agencyId: input.producerAgencyId ?? null,
    };

    const where = jurisdiction(input.jurisdiction.country, input.jurisdiction.subdivision);
    const effectiveDate = parseEffectiveDate(input.effectiveDate);
    const resolved = await resolve(ctx, input, where, effectiveDate.toString());
    const releases = resolved.releases.filter((release) => release.rating);
    const intake = releases[0];

    if (!intake) {
      throw new ProductUnavailableError({
        productName: resolved.name,
        jurisdiction: where,
        effectiveDate: effectiveDate.toString(),
      });
    }

    const form = intakeForm(intake, CHANNEL, STAGE);

    if (!form) {
      throw new IntakeFormMissingError({
        productName: resolved.name,
        channel: CHANNEL,
        stage: STAGE,
      });
    }

    const productName =
      "productId" in input ? resolved.name : await deps.catalog.productName(ctx, intake.productId);

    return deps.uow.run(ctx, async (tx) => {
      const sequence = await deps.submissions.nextSequence(tx, ctx);

      const submission = Submission.start(
        {
          tenantId: ctx.tenantId,
          number: formatSubmissionNumber(sequence),
          release: { ...candidateOf(intake), formKey: form.key },
          offering: resolved.offering,
          candidates: releases.map(candidateOf),
          jurisdiction: where,
          effectiveDate,
          channel: CHANNEL,
          stage: STAGE,
          producer,
        },
        deps.clocks.forTenant(ctx.tenantId),
      );

      await deps.submissions.save(tx, submission);
      await deps.outbox.add(tx, submission.pullEvents());

      return toSubmissionDto(
        submission,
        { product: productName, offering: resolved.offering && resolved.name },
        { riskSchema: intake.riskSchema, form },
      );
    });
  };
}

const candidateOf = (release: CatalogRelease): Candidate => ({
  productId: release.productId,
  productReleaseId: release.id,
  productVersionId: release.productVersionId,
  productVersion: release.version,
});

function parseEffectiveDate(value: string) {
  try {
    return parsePlainDate(value);
  } catch {
    throw invalid(`${value} isn't a valid effective date`, { field: "effectiveDate" });
  }
}

export type StartSubmission = ReturnType<typeof makeStartSubmission>;
