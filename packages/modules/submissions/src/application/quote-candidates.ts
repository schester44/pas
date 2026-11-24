import type { ClockProvider, TenantContext } from "@pas/kernel";
import type { Candidate } from "../domain/quote-options";
import { Quote } from "../domain/quote";
import type { Submission } from "../domain/submission";
import type { CatalogRelease, ProductCatalog } from "../ports/product-catalog";
import { type EvaluationDeps, type EvaluationOutput, evaluateQuote } from "./evaluate-quote";
import { termOf } from "./quoting";

export interface EvaluatedCandidate extends EvaluationOutput {
  candidate: Candidate;
  release: CatalogRelease;
  term: ReturnType<typeof termOf>;
}

/** Submissions from before offerings carry no candidates; their pinned release is the only one. */
export function candidatesOf(submission: Submission): Candidate[] {
  const s = submission.toSnapshot();

  return s.candidates.length > 0
    ? s.candidates
    : [
        {
          productId: s.productId,
          productReleaseId: s.productReleaseId,
          productVersionId: s.productVersionId,
          productVersion: s.productVersion,
        },
      ];
}

/** Auto-evaluation of one candidate release on the submission's risk (PLAN §6.0, §7.2). */
export async function evaluateCandidate(
  deps: EvaluationDeps & { catalog: ProductCatalog },
  ctx: TenantContext,
  submission: Submission,
  candidate: Candidate,
  risk: Record<string, unknown>,
): Promise<EvaluatedCandidate> {
  const s = submission.toSnapshot();
  const release = await deps.catalog.getRelease(ctx, candidate.productReleaseId);
  const term = termOf(release, s.effectiveDate);

  const output = await evaluateQuote(deps, ctx, {
    release,
    submissionId: s.id,
    risk,
    jurisdiction: s.jurisdiction,
    termStart: term.termStart,
    termEnd: term.termEnd,
    selection: null,
    channel: s.channel,
    subject: { type: "submission", id: s.id },
  });

  return { ...output, candidate, release, term };
}

export function quoteFor(
  submission: Submission,
  evaluated: EvaluatedCandidate,
  risk: Record<string, unknown>,
  clocks: ClockProvider,
): Quote {
  const s = submission.toSnapshot();
  const clock = clocks.forTenant(s.tenantId);
  const { terms, termStart, termEnd, reviewWithin } = evaluated.term;

  return Quote.create(
    {
      tenantId: s.tenantId,
      submissionId: submission.id,
      submissionNumber: s.number,
      productReleaseId: evaluated.candidate.productReleaseId,
      termStart,
      termEnd,
      riskData: risk,
      selection: evaluated.selection,
      evaluation: evaluated.evaluation,
      timing: {
        expiresAt: clock.now().add({ hours: terms.validityDays * 24 }),
        reviewWithin,
      },
      actor: { type: "user", id: s.producer.userId, name: s.producer.name },
    },
    clock,
  );
}
