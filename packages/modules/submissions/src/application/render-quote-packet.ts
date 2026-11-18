import type { Clock, TenantContext, UnitOfWork } from "@pas/kernel";
import type { SubmissionScope } from "../domain/scope";
import type { ProductCatalog } from "../ports/product-catalog";
import type { QuoteDocuments, RenderedPacket } from "../ports/quote-documents";
import type { QuoteRepository } from "../ports/quote-repository";
import type { SubmissionRepository } from "../ports/submission-repository";
import { quoteDocumentContext } from "./document-context";
import { loadQuote } from "./quoting";

export const REVIEW_TRANSACTIONS = ["quote", "new_business"] as const;
export const PENDING_POLICY_NUMBER = "Assigned at binding";

/** The documents the insured reviews and signs: the release's quote and new-business packet. */
export function makeRenderQuotePacket(deps: {
  uow: UnitOfWork;
  submissions: SubmissionRepository;
  quotes: QuoteRepository;
  catalog: ProductCatalog;
  documents: QuoteDocuments;
  clock: Clock;
}) {
  return async function renderQuotePacket(
    ctx: TenantContext,
    scope: SubmissionScope,
    input: { submissionId: string },
  ): Promise<RenderedPacket & { revision: number }> {
    const { submission, quote } = await deps.uow.run(ctx, (tx) =>
      loadQuote(deps, tx, ctx, scope, input.submissionId),
    );

    const q = quote.toSnapshot();
    const s = submission.toSnapshot();

    const [release, productName] = await Promise.all([
      deps.catalog.getRelease(ctx, q.productReleaseId),
      deps.catalog.productName(ctx, s.productId),
    ]);

    const packet = await deps.documents.render(ctx, {
      release,
      transactions: REVIEW_TRANSACTIONS,
      context: quoteDocumentContext({
        submission,
        quote,
        release,
        productName,
        policyNumber: PENDING_POLICY_NUMBER,
        issuedDate: deps.clock.today("UTC"),
      }),
    });

    return { ...packet, revision: q.revision };
  };
}

export type RenderQuotePacket = ReturnType<typeof makeRenderQuotePacket>;
