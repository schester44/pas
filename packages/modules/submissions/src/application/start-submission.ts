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
import type { ProductCatalog } from "../ports/product-catalog";
import type { SubmissionRepository } from "../ports/submission-repository";
import { type SubmissionDto, toSubmissionDto } from "./dto";
import { intakeForm } from "./intake";

export interface StartSubmissionInput {
  productId: string;
  jurisdiction: Jurisdiction;
  effectiveDate: string;
  producerName: string;
}

const CHANNEL: SubmissionChannel = "agent";
const STAGE: SubmissionStage = "quote";

export function makeStartSubmission(deps: {
  uow: UnitOfWork;
  outbox: Outbox;
  submissions: SubmissionRepository;
  catalog: ProductCatalog;
  clocks: ClockProvider;
}) {
  return async function startSubmission(
    ctx: TenantContext,
    input: StartSubmissionInput,
  ): Promise<SubmissionDto> {
    if (ctx.actor.type !== "user") {
      throw new DomainError("forbidden", "Only a signed-in producer can start a submission");
    }

    const producer = { userId: ctx.actor.userId, name: input.producerName };
    const where = jurisdiction(input.jurisdiction.country, input.jurisdiction.subdivision);
    const effectiveDate = parseEffectiveDate(input.effectiveDate);

    const [productName, release] = await Promise.all([
      deps.catalog.productName(ctx, input.productId),
      deps.catalog.resolveNewBusiness(ctx, {
        productId: input.productId,
        jurisdiction: where,
        effectiveDate: effectiveDate.toString(),
      }),
    ]);

    if (!release?.rating) {
      throw new ProductUnavailableError({
        productName,
        jurisdiction: where,
        effectiveDate: effectiveDate.toString(),
      });
    }

    const form = intakeForm(release, CHANNEL, STAGE);

    if (!form) throw new IntakeFormMissingError({ productName, channel: CHANNEL, stage: STAGE });

    return deps.uow.run(ctx, async (tx) => {
      const sequence = await deps.submissions.nextSequence(tx, ctx);

      const submission = Submission.start(
        {
          tenantId: ctx.tenantId,
          number: formatSubmissionNumber(sequence),
          release: {
            productId: release.productId,
            productReleaseId: release.id,
            productVersionId: release.productVersionId,
            productVersion: release.version,
            formKey: form.key,
          },
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

      return toSubmissionDto(submission, productName, { riskSchema: release.riskSchema, form });
    });
  };
}

function parseEffectiveDate(value: string) {
  try {
    return parsePlainDate(value);
  } catch {
    throw invalid(`${value} isn't a valid effective date`, { field: "effectiveDate" });
  }
}

export type StartSubmission = ReturnType<typeof makeStartSubmission>;
