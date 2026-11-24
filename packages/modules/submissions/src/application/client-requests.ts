import type { Instant, TenantContext, UnitOfWork } from "@pas/kernel";
import type { ClientRequest } from "../domain/client-request";
import { type CompletionRules, completionRules } from "../domain/completion";
import type { Quote } from "../domain/quote";
import type { SubmissionScope } from "../domain/scope";
import type { ProductCatalog } from "../ports/product-catalog";
import type { QuoteRepository } from "../ports/quote-repository";
import type { SubmissionRepository } from "../ports/submission-repository";
import { loadQuote } from "./quoting";

export interface ClientRequestDto {
  id: string;
  email: string;
  name: string;
  status: "sent" | "opened" | "completed" | "revoked" | "expired";
  sentAt: string;
  sentBy: string;
  openedAt: string | null;
  completedAt: string | null;
  expiresAt: string;
}

export function toClientRequestDto(
  request: ClientRequest,
  now: Instant,
  quote: Quote,
): ClientRequestDto {
  const r = request.toSnapshot();
  const status = quote.status === "bound" && !r.revokedAt ? "completed" : request.status(now);

  return {
    id: r.id,
    email: r.email,
    name: r.name,
    status,
    sentAt: r.sentAt.toString(),
    sentBy: r.sentBy.name,
    openedAt: r.openedAt?.toString() ?? null,
    completedAt:
      (r.completedAt ?? (status === "completed" ? quote.toSnapshot().boundAt : null))?.toString() ??
      null,
    expiresAt: r.expiresAt.toString(),
  };
}

/** The release's completion rules for a quote. Reads the catalog, so never inside a unit of work. */
export async function completionRulesFor(
  deps: {
    uow: UnitOfWork;
    submissions: SubmissionRepository;
    quotes: QuoteRepository;
    catalog: ProductCatalog;
  },
  ctx: TenantContext,
  scope: SubmissionScope,
  submissionId: string,
): Promise<CompletionRules> {
  const { quote } = await deps.uow.run(ctx, (tx) => loadQuote(deps, tx, ctx, scope, submissionId));
  const release = await deps.catalog.getRelease(ctx, quote.toSnapshot().productReleaseId);

  return completionRules(release.lifecycle);
}
