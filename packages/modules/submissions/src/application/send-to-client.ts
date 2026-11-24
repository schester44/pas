import {
  type ClockProvider,
  conflict,
  type Outbox,
  type TenantContext,
  type UnitOfWork,
} from "@pas/kernel";
import { ClientRequest } from "../domain/client-request";
import { insuredCompletesAny } from "../domain/completion";
import type { SubmissionScope } from "../domain/scope";
import type { ClientRequestRepository } from "../ports/client-request-repository";
import type { ProductCatalog } from "../ports/product-catalog";
import type { QuoteRepository } from "../ports/quote-repository";
import type { SubmissionRepository } from "../ports/submission-repository";
import { type ClientRequestDto, completionRulesFor, toClientRequestDto } from "./client-requests";
import { loadQuote } from "./quoting";

/**
 * Emails the insured a link to finish their part of the application. Sending to the same address
 * again resends the open request; a different address replaces it, so only one link ever works.
 */
export function makeSendToClient(deps: {
  uow: UnitOfWork;
  outbox: Outbox;
  submissions: SubmissionRepository;
  quotes: QuoteRepository;
  catalog: ProductCatalog;
  requests: ClientRequestRepository;
  clocks: ClockProvider;
}) {
  return async function sendToClient(
    ctx: TenantContext,
    scope: SubmissionScope,
    input: { submissionId: string; email: string; name: string; actorName: string },
  ): Promise<{ request: ClientRequestDto; requestId: string }> {
    const rules = await completionRulesFor(deps, ctx, scope, input.submissionId);

    if (!insuredCompletesAny(rules)) {
      throw conflict("The producer completes every step for this product", {
        reason: "nothing_for_client",
      });
    }

    const clock = deps.clocks.forTenant(ctx.tenantId);

    const sentBy = {
      userId: ctx.actor.type === "user" ? ctx.actor.userId : null,
      name: input.actorName,
    };

    return deps.uow.run(ctx, async (tx) => {
      const { submission, quote } = await loadQuote(deps, tx, ctx, scope, input.submissionId);
      const q = quote.toSnapshot();

      if (quote.status !== "quoted") {
        throw conflict(`This quote is ${quote.status}, so it can't be sent`, {
          reason: "invalid_status",
        });
      }

      if (!quote.requirements().find((r) => r.kind === "parties")?.satisfied) {
        throw conflict("Save the policy details before sending this to the client", {
          reason: "details_missing",
        });
      }

      const latest = await deps.requests.findLatestByQuote(tx, ctx, q.id);
      const status = latest?.status(clock.now());

      const reusable =
        latest && (status === "sent" || status === "opened") && latest.isFor(input.email);

      let request: ClientRequest;

      if (reusable) {
        latest.resend(sentBy, clock);
        request = latest;
      } else {
        if (latest) {
          latest.revoke(clock);
          await deps.requests.save(tx, latest);
        }

        request = ClientRequest.send(
          {
            tenantId: ctx.tenantId,
            quoteId: q.id,
            submissionId: q.submissionId,
            submissionNumber: q.submissionNumber,
            producerId: submission.toSnapshot().producer.userId,
            email: input.email,
            name: input.name,
            sentBy,
            expiresAt: q.expiresAt,
          },
          clock,
        );
      }

      quote.noteSentToClient(
        {
          email: request.toSnapshot().email,
          by: { type: "user", ...(sentBy.userId && { id: sentBy.userId }), name: sentBy.name },
        },
        clock,
      );

      await deps.requests.save(tx, request);
      await deps.quotes.save(tx, quote);
      await deps.outbox.add(tx, request.pullEvents());

      return { request: toClientRequestDto(request, clock.now(), quote), requestId: request.id };
    });
  };
}

export type SendToClient = ReturnType<typeof makeSendToClient>;
