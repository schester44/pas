import {
  type Clock,
  conflict,
  newId,
  type Outbox,
  type TenantContext,
  type UnitOfWork,
} from "@pas/kernel";
import type { ObjectStorage } from "@pas/storage";
import { outstandingFor } from "../domain/bind-requirements";
import type { Quote } from "../domain/quote";
import type { SubmissionScope } from "../domain/scope";
import type { Submission } from "../domain/submission";
import type { PaymentGateway, PaymentMethodInput } from "../ports/payment-gateway";
import type { NewBusinessRequest, PolicyIssuer, TimelineActor } from "../ports/policy-issuer";
import type { CatalogRelease, ProductCatalog } from "../ports/product-catalog";
import type { QuoteDocuments } from "../ports/quote-documents";
import type { QuoteRepository } from "../ports/quote-repository";
import type { SubmissionRepository } from "../ports/submission-repository";
import { namedInsuredOf, quoteDocumentContext } from "./document-context";
import { type EvaluationDeps, evaluateQuote } from "./evaluate-quote";
import { JOURNEY_EVENTS, type QuoteJourney } from "./quote-journey";
import { type QuoteDto, toQuoteDto } from "./quote-dto";
import { loadQuote, termOf } from "./quoting";

export type BindQuoteResult =
  | { status: "bound"; quote: QuoteDto }
  | { status: "payment_declined"; message: string; quote: QuoteDto }
  | { status: "rechecked"; quote: QuoteDto };

type Deps = EvaluationDeps & {
  uow: UnitOfWork;
  outbox: Outbox;
  submissions: SubmissionRepository;
  quotes: QuoteRepository;
  catalog: ProductCatalog;
  payments: PaymentGateway;
  policies: PolicyIssuer;
  documents: QuoteDocuments;
  storage: ObjectStorage;
  journey: QuoteJourney;
  clock: Clock;
};

/**
 * Pay and bind (PLAN §7.2.1 steps 5–6): re-check against current data and date, authorize, issue
 * the policy, capture, then generate the packet. Every step is idempotent, so a retry finishes.
 */
export function makeBindQuote(deps: Deps) {
  return async function bindQuote(
    ctx: TenantContext,
    scope: SubmissionScope,
    input: { submissionId: string; method: PaymentMethodInput; actorName: string },
  ): Promise<BindQuoteResult> {
    const actor: TimelineActor =
      ctx.actor.type === "user"
        ? { type: "user", id: ctx.actor.userId, name: input.actorName }
        : { type: ctx.actor.type === "api_client" ? "api" : "system", name: input.actorName };

    const { submission, quote } = await deps.uow.run(ctx, (tx) =>
      loadQuote(deps, tx, ctx, scope, input.submissionId),
    );

    if (quote.status === "bound") return { status: "bound", quote: dto(quote, submission) };

    const open = outstandingFor(quote.requirements(), "pay");

    if (open.length > 0) {
      throw conflict(`Finish ${open.map((r) => r.title.toLowerCase()).join(", ")} first`, {
        reason: "requirements_open",
        requirements: open.map((r) => r.id),
      });
    }

    const q = quote.toSnapshot();
    const s = submission.toSnapshot();

    const [release, productName] = await Promise.all([
      deps.catalog.getRelease(ctx, q.productReleaseId),
      deps.catalog.productName(ctx, s.productId),
    ]);

    const rechecked = await recheck(deps, ctx, scope, release, input.submissionId);

    if (rechecked) return { status: "rechecked", quote: rechecked };

    const amount = q.evaluation.total;

    const authorization = await deps.payments.authorize(ctx, {
      reference: q.submissionNumber,
      idempotencyKey: `${q.id}:r${q.revision}`,
      amount,
      method: input.method,
    });

    if (authorization.status === "declined") {
      await deps.uow.run(ctx, async (tx) => {
        const current = await loadQuote(deps, tx, ctx, scope, input.submissionId);

        current.quote.notePaymentFailed(
          { ...authorization, last4: authorization.method.last4 },
          actor,
          deps.clock,
        );

        await deps.quotes.save(tx, current.quote);

        await deps.quotes.savePayment(tx, ctx, {
          id: newId(),
          quoteId: quote.id,
          provider: deps.payments.provider,
          providerRef: null,
          status: "declined",
          amount,
          method: authorization.method,
          failure: authorization.code,
          recordedAt: deps.clock.now(),
        });
      });

      return {
        status: "payment_declined",
        message: authorization.message,
        quote: dto(quote, submission),
      };
    }

    let issued;

    try {
      const history = await deps.uow.run(ctx, (tx) => deps.quotes.listActivity(tx, ctx, quote.id));

      issued = await deps.policies.issue(ctx, {
        ...issueRequest(quote, submission, release, productName),
        actor,
        history: history.map((entry) => ({
          type: entry.type,
          occurredAt: entry.occurredAt.toString(),
          actor: entry.actor,
          summary: entry.summary,
          data: entry.data,
        })),
      });
    } catch (error) {
      await deps.payments.void(ctx, { authorizationId: authorization.authorizationId });

      throw error;
    }

    await deps.payments.capture(ctx, { authorizationId: authorization.authorizationId, amount });

    await deps.policies.applyPayment(ctx, {
      invoiceId: issued.invoice.id,
      amount: amount.toJSON(),
      provider: deps.payments.provider,
      providerRef: authorization.authorizationId,
      method: { ...authorization.method },
      methodLabel: `${authorization.method.brand} ending ${authorization.method.last4}`,
      actor,
    });

    const packet = await deps.documents.render(ctx, {
      release,
      transactions: ["new_business"],
      context: quoteDocumentContext({
        submission,
        quote,
        release,
        productName,
        policyNumber: issued.policyNumber,
        issuedDate: deps.clock.today("UTC"),
      }),
    });

    const packetKey = `tenants/${ctx.tenantId}/policies/${issued.policyId}/${issued.transactionId}/packet.pdf`;

    await deps.storage.put({ key: packetKey, body: packet.pdf, contentType: "application/pdf" });

    const signedKey = q.signature!.documentKey;
    const signed = await deps.storage.get(signedKey);

    await deps.policies.attachDocuments(ctx, {
      policyId: issued.policyId,
      transactionId: issued.transactionId,
      documents: [
        {
          kind: "policy_packet",
          title: "Policy documents",
          storageKey: packetKey,
          sizeBytes: packet.pdf.byteLength,
        },
        {
          kind: "signed_application",
          title: "Signed application",
          storageKey: signedKey,
          sizeBytes: signed?.body.byteLength ?? 0,
        },
      ],
      actor: { type: "system", name: "Document generation" },
    });

    const bound = await deps.uow.run(ctx, async (tx) => {
      const current = await loadQuote(deps, tx, ctx, scope, input.submissionId);
      const now = deps.clock.now();

      current.quote.markBound(
        {
          policy: { id: issued.policyId, number: issued.policyNumber },
          payment: {
            paymentId: authorization.authorizationId,
            provider: deps.payments.provider,
            amount,
            brand: authorization.method.brand,
            last4: authorization.method.last4,
            capturedAt: now,
          },
        },
        deps.clock,
      );

      await deps.quotes.save(tx, current.quote);

      await deps.quotes.savePayment(tx, ctx, {
        id: newId(),
        quoteId: current.quote.id,
        provider: deps.payments.provider,
        providerRef: authorization.authorizationId,
        status: "captured",
        amount,
        method: authorization.method,
        failure: null,
        recordedAt: now,
      });

      await deps.outbox.add(tx, current.quote.pullEvents());

      return current;
    });

    await deps.journey.signal(ctx, bound.quote, JOURNEY_EVENTS.changed);

    return { status: "bound", quote: dto(bound.quote, bound.submission) };
  };
}

const dto = (quote: Quote, submission: Submission) => toQuoteDto(quote, submission, "producer");

/** Bind-time re-check (PLAN §7.2): null when the quote still binds as signed. */
async function recheck(
  deps: Deps,
  ctx: TenantContext,
  scope: SubmissionScope,
  release: CatalogRelease,
  submissionId: string,
): Promise<QuoteDto | null> {
  const { submission, quote } = await deps.uow.run(ctx, (tx) =>
    loadQuote(deps, tx, ctx, scope, submissionId),
  );

  const q = quote.toSnapshot();
  const { reviewWithin } = termOf(release, q.termStart);

  const { evaluation } = await evaluateQuote(deps, ctx, {
    release,
    risk: q.riskData,
    jurisdiction: submission.toSnapshot().jurisdiction,
    termStart: q.termStart,
    termEnd: q.termEnd,
    selection: q.selection,
  });

  return deps.uow.run(ctx, async (tx) => {
    const current = await loadQuote(deps, tx, ctx, scope, submissionId);

    if (current.quote.recheck(evaluation, reviewWithin, deps.clock)) return null;

    await deps.quotes.save(tx, current.quote);
    await deps.outbox.add(tx, current.quote.pullEvents());
    await deps.journey.signal(ctx, current.quote, JOURNEY_EVENTS.changed);

    return dto(current.quote, current.submission);
  });
}

function issueRequest(
  quote: Quote,
  submission: Submission,
  release: CatalogRelease,
  productName: string,
): Omit<NewBusinessRequest, "actor" | "history"> {
  const q = quote.toSnapshot();
  const s = submission.toSnapshot();
  const names = new Map(release.coverages.map((c) => [c.code, c.name]));

  const coverages = q.evaluation.premium.map((line) => {
    const choice = q.selection.find(
      (c) => c.coverage === line.coverage && c.exposure === line.exposure,
    );

    return {
      coverage: line.coverage,
      name: names.get(line.coverage) ?? line.coverage,
      ...(line.exposure !== undefined && { exposure: line.exposure }),
      ...(choice?.limit && { limit: choice.limit }),
      ...(choice?.deductible && { deductible: choice.deductible }),
      premium: line.premium.toJSON(),
    };
  });

  const taxesFees = q.evaluation.taxesFees.map((line) => ({
    code: line.code,
    label: line.label,
    remitter: line.remitter,
    amount: line.amount.toJSON(),
  }));

  return {
    quoteId: q.id,
    submissionId: q.submissionId,
    productId: s.productId,
    productName,
    productReleaseId: q.productReleaseId,
    productVersion: release.version,
    jurisdiction: s.jurisdiction,
    effectiveDate: q.termStart.toString(),
    expirationDate: q.termEnd.toString(),
    insuredName: namedInsuredOf(quote),
    producer: { id: s.producer.userId, name: s.producer.name },
    currency: q.evaluation.total.currency,
    coverages,
    taxesFees,
    writtenPremium: q.evaluation.writtenPremium.toJSON(),
    snapshot: {
      risk: q.riskData,
      coverages,
      taxesFees,
      writtenPremium: q.evaluation.writtenPremium.toJSON(),
      total: q.evaluation.total.toJSON(),
      parties: q.details,
      rater: q.evaluation.rating?.artifact ?? null,
      decisions: q.evaluation.decisions.map((d) => ({ ref: d.ref, result: d.result })),
      signature: q.signature && {
        provider: q.signature.provider,
        envelopeId: q.signature.envelopeId,
        signedAt: q.signature.signedAt.toString(),
        documentSha256: q.signature.documentSha256,
      },
    },
  };
}

export type BindQuote = ReturnType<typeof makeBindQuote>;
