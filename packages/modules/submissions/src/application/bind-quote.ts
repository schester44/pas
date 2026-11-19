import {
  conflict,
  DomainError,
  Money,
  newId,
  type Outbox,
  type TenantContext,
  type UnitOfWork,
  type ClockProvider,
  type ProviderFor,
} from "@pas/kernel";
import { addressesIn, addressIdsIn } from "@pas/addresses";
import type { ObjectStorage } from "@pas/storage";
import { outstandingFor } from "../domain/bind-requirements";
import type { Quote } from "../domain/quote";
import type { SubmissionScope } from "../domain/scope";
import type { Submission } from "../domain/submission";
import { type BillingMethodOption, mortgageeOf } from "../domain/billing-methods";
import type { AddressRegistry } from "../ports/address-registry";
import type { AgencyBilling } from "../ports/agency-bill-check";
import type { BindConditions } from "../ports/bind-conditions";
import type { PaymentGateway, PaymentMethodInput } from "../ports/payment-gateway";
import type { ProducerLicenseCheck } from "../ports/producer-license-check";
import type {
  IssuedPolicy,
  NewBusinessRequest,
  PolicyIssuer,
  TimelineActor,
} from "../ports/policy-issuer";
import type { CatalogRelease, ProductCatalog } from "../ports/product-catalog";
import type { QuoteDocuments } from "../ports/quote-documents";
import type { QuoteRepository } from "../ports/quote-repository";
import type { SubmissionRepository } from "../ports/submission-repository";
import { insuredPartiesOf, mailingAddressOf } from "../domain/insured";
import { namedInsuredOf, quoteDocumentContext } from "./document-context";
import { billingOptionsFor } from "./billing-options";
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
  payments: ProviderFor<PaymentGateway>;
  policies: PolicyIssuer;
  documents: QuoteDocuments;
  storage: ObjectStorage;
  journey: QuoteJourney;
  clocks: ClockProvider;
  licensing: ProducerLicenseCheck;
  addresses: AddressRegistry;
  conditions: BindConditions;
  agencyBilling: AgencyBilling;
};

/**
 * Pay and bind (PLAN §7.2.1 steps 5–6): re-check against current data and date, authorize, issue
 * the policy, capture, then generate the packet. Every step is idempotent, so a retry finishes.
 */
export function makeBindQuote(deps: Deps) {
  return async function bindQuote(
    ctx: TenantContext,
    scope: SubmissionScope,
    input: {
      submissionId: string;
      method?: PaymentMethodInput;
      billingMethod?: BillingMethodOption["method"];
      actorName: string;
      autopay?: boolean;
    },
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

    const conditions = await deps.conditions.outstanding(ctx, {
      quoteId: q.id,
      submissionId: q.submissionId,
    });

    if (conditions.length > 0) {
      throw conflict(
        `Clear the pre-bind subjectivities first: ${conditions.map((c) => c.title).join(", ")}`,
        { reason: "subjectivities_open" },
      );
    }

    const [release, productName] = await Promise.all([
      deps.catalog.getRelease(ctx, q.productReleaseId),
      deps.catalog.productName(ctx, s.productId),
    ]);

    const licensing = await deps.licensing.check(ctx, {
      producerId: s.producer.userId,
      productId: s.productId,
      jurisdiction: s.jurisdiction,
      effectiveDate: q.termStart.toString(),
    });

    if (licensing.blocks) {
      throw new DomainError(
        "precondition_failed",
        `${licensing.message}. Update the license or change the producer of record to bind.`,
        { reason: "producer_unlicensed" },
      );
    }

    const rechecked = await recheck(deps, ctx, scope, release, input.submissionId);

    if (rechecked) return { status: "rechecked", quote: rechecked };

    if (input.billingMethod && input.billingMethod !== "direct") {
      return bindBilledTo(deps, ctx, scope, {
        submissionId: input.submissionId,
        billingMethod: input.billingMethod,
        actor,
        release,
        productName,
      });
    }

    if (!input.method) {
      throw new DomainError("invalid", "Pay by card, or choose another billing method");
    }

    const method = input.method;

    const offer = quote.selectedPayPlan();
    const plan = offer ? (release.billing.payPlans.find((p) => p.key === offer.key) ?? null) : null;

    const amount = offer
      ? Money.of(offer.dueToday.amount, offer.dueToday.currency)
      : q.evaluation.total;

    const payments = await deps.payments.for(ctx);

    const authorization = await payments.authorize(ctx, {
      reference: q.submissionNumber,
      idempotencyKey: `${q.id}:r${q.revision}`,
      amount,
      method,
    });

    if (authorization.status === "declined") {
      await deps.uow.run(ctx, async (tx) => {
        const current = await loadQuote(deps, tx, ctx, scope, input.submissionId);

        current.quote.notePaymentFailed(
          { ...authorization, last4: authorization.method.last4 },
          actor,
          deps.clocks.forTenant(ctx.tenantId),
        );

        await deps.quotes.save(tx, current.quote);

        await deps.quotes.savePayment(tx, ctx, {
          id: newId(),
          quoteId: quote.id,
          provider: payments.provider,
          providerRef: null,
          status: "declined",
          amount,
          method: authorization.method,
          failure: authorization.code,
          recordedAt: deps.clocks.forTenant(ctx.tenantId).now(),
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
        billing: { method: "direct", payPlan: plan, dunning: release.billing.dunning },
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
      await payments.void(ctx, { authorizationId: authorization.authorizationId });

      throw error;
    }

    await payments.capture(ctx, { authorizationId: authorization.authorizationId, amount });
    await trackPolicyAddresses(deps, ctx, { quote, submission, release, policy: issued });

    await deps.policies.applyPayment(ctx, {
      invoiceId: issued.invoice.id,
      amount: amount.toJSON(),
      provider: payments.provider,
      providerRef: authorization.authorizationId,
      method: { ...authorization.method },
      methodLabel: `${authorization.method.brand} ending ${authorization.method.last4}`,
      actor,
    });

    if (input.autopay && plan && plan.installments > 1) {
      await enrollAutopay(deps, ctx, {
        policyId: issued.policyId,
        reference: issued.policyNumber,
        method,
        payer: namedInsuredOf(quote),
        actor,
      });
    }

    await attachPacket(deps, ctx, { quote, submission, release, productName, issued });

    const bound = await deps.uow.run(ctx, async (tx) => {
      const current = await loadQuote(deps, tx, ctx, scope, input.submissionId);
      const now = deps.clocks.forTenant(ctx.tenantId).now();

      current.quote.markBound(
        {
          policy: { id: issued.policyId, number: issued.policyNumber },
          payment: {
            paymentId: authorization.authorizationId,
            provider: payments.provider,
            amount,
            brand: authorization.method.brand,
            last4: authorization.method.last4,
            capturedAt: now,
          },
        },
        deps.clocks.forTenant(ctx.tenantId),
      );

      await deps.quotes.save(tx, current.quote);

      await deps.quotes.savePayment(tx, ctx, {
        id: newId(),
        quoteId: current.quote.id,
        provider: payments.provider,
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

/** The policy packet and the signed application on the new policy. */
async function attachPacket(
  deps: Deps,
  ctx: TenantContext,
  input: {
    quote: Quote;
    submission: Submission;
    release: CatalogRelease;
    productName: string;
    issued: IssuedPolicy;
  },
) {
  const { quote, submission, release, productName, issued } = input;

  const packet = await deps.documents.render(ctx, {
    release,
    transactions: ["new_business"],
    context: quoteDocumentContext({
      submission,
      quote,
      release,
      productName,
      policyNumber: issued.policyNumber,
      issuedDate: deps.clocks.forTenant(ctx.tenantId).today("UTC"),
    }),
  });

  const packetKey = `tenants/${ctx.tenantId}/policies/${issued.policyId}/${issued.transactionId}/packet.pdf`;

  await deps.storage.put({ key: packetKey, body: packet.pdf, contentType: "application/pdf" });

  const signedKey = quote.toSnapshot().signature!.documentKey;
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
}

/**
 * Binds on agency or mortgagee bill (PLAN §13): nothing is collected now; the agency's account
 * current or the lender's invoice carries the premium. Agency bill respects the credit limit.
 */
async function bindBilledTo(
  deps: Deps,
  ctx: TenantContext,
  scope: SubmissionScope,
  input: {
    submissionId: string;
    billingMethod: "agency" | "mortgagee";
    actor: TimelineActor;
    release: CatalogRelease;
    productName: string;
  },
): Promise<BindQuoteResult> {
  const { release, actor } = input;

  const { submission, quote } = await deps.uow.run(ctx, (tx) =>
    loadQuote(deps, tx, ctx, scope, input.submissionId),
  );

  const option = (await billingOptionsFor(deps, ctx, { quote, submission, release })).find(
    (o) => o.method === input.billingMethod,
  );

  if (!option?.available || !option.payPlan) {
    throw new DomainError(
      "precondition_failed",
      option?.reason ??
        `${input.billingMethod === "agency" ? "Agency" : "Mortgagee"} bill isn't offered on this quote`,
      { reason: "billing_method_unavailable" },
    );
  }

  const plan = release.billing.payPlans.find((p) => p.key === option.payPlan)!;
  const mortgagee = mortgageeOf(quote.toSnapshot().details);
  const history = await deps.uow.run(ctx, (tx) => deps.quotes.listActivity(tx, ctx, quote.id));
  const agency = submission.toSnapshot().producer.agencyId;

  const payer =
    input.billingMethod === "agency"
      ? {
          payer: "agency" as const,
          payerRef: option.payer?.reference ?? agency,
          payerName: option.payer?.name ?? null,
          payerAddress: null,
        }
      : {
          payer: "mortgagee" as const,
          payerRef: mortgagee?.reference?.trim() || null,
          payerName: mortgagee!.name.trim(),
          payerAddress: mortgagee?.address?.line1?.trim() ? mortgagee.address : null,
        };

  const issued = await deps.policies.issue(ctx, {
    ...issueRequest(quote, submission, release, input.productName),
    billing: {
      method: input.billingMethod,
      payPlan: plan,
      dunning: release.billing.dunning,
      payer,
      ...(input.billingMethod === "mortgagee" && {
        mortgagee: { followUp: release.billing.mortgagee, lenderEmail: mortgagee?.email ?? null },
      }),
    },
    actor,
    history: history.map((entry) => ({
      type: entry.type,
      occurredAt: entry.occurredAt.toString(),
      actor: entry.actor,
      summary: entry.summary,
      data: entry.data,
    })),
  });

  await trackPolicyAddresses(deps, ctx, { quote, submission, release, policy: issued });

  await attachPacket(deps, ctx, {
    quote,
    submission,
    release,
    productName: input.productName,
    issued,
  });

  const bound = await deps.uow.run(ctx, async (tx) => {
    const current = await loadQuote(deps, tx, ctx, scope, input.submissionId);

    current.quote.markBound(
      { policy: { id: issued.policyId, number: issued.policyNumber }, payment: null },
      deps.clocks.forTenant(ctx.tenantId),
    );

    await deps.quotes.save(tx, current.quote);
    await deps.outbox.add(tx, current.quote.pullEvents());

    return current;
  });

  await deps.journey.signal(ctx, bound.quote, JOURNEY_EVENTS.changed);

  return { status: "bound", quote: dto(bound.quote, bound.submission) };
}

/** Saves the card for autopay; a card the provider won't save leaves the policy on invoices. */
async function enrollAutopay(
  deps: Deps,
  ctx: TenantContext,
  input: {
    policyId: string;
    reference: string;
    method: PaymentMethodInput;
    payer: string;
    actor: TimelineActor;
  },
) {
  const payments = await deps.payments.for(ctx);

  const saved = await payments.saveMethod(ctx, {
    reference: input.reference,
    method: input.method,
    customer: { name: input.payer },
  });

  if (saved.status === "declined") return;

  await deps.policies.enrollAutopay(ctx, {
    policyId: input.policyId,
    provider: payments.provider,
    methodRef: saved.methodRef,
    customerRef: saved.customerRef,
    method: saved.method,
    consent: { acceptedAt: deps.clocks.forTenant(ctx.tenantId).now().toString(), by: input.payer },
    actor: input.actor,
  });
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
    channel: submission.toSnapshot().channel,
    modifications: quote.modifications(),
  });

  return deps.uow.run(ctx, async (tx) => {
    const current = await loadQuote(deps, tx, ctx, scope, submissionId);

    if (current.quote.recheck(evaluation, reviewWithin, deps.clocks.forTenant(ctx.tenantId)))
      return null;

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
): Omit<NewBusinessRequest, "actor" | "history" | "billing"> {
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
    insureds: insuredPartiesOf(
      q.details?.namedInsureds ?? [],
      q.riskData,
      q.details?.mailingAddress ?? mailingAddressOf(q.riskData),
    ),
    producer: { id: s.producer.userId, name: s.producer.name, agencyId: s.producer.agencyId },
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

/** The bound policy takes over the submission's locations in the address registry. */
async function trackPolicyAddresses(
  deps: Deps,
  ctx: TenantContext,
  input: {
    quote: Quote;
    submission: Submission;
    release: CatalogRelease;
    policy: { policyId: string; policyNumber: string };
  },
) {
  const q = input.quote.toSnapshot();
  const s = input.submission.toSnapshot();
  const stamped = addressesIn(input.release.riskSchema, q.riskData);

  const mailing = addressIdsIn(q.details?.mailingAddress ?? null).map((addressId) => ({
    addressId,
    role: "mailing" as const,
  }));

  await deps.addresses.track(ctx, {
    subject: { kind: "policy", id: input.policy.policyId },
    label: input.policy.policyNumber,
    productId: s.productId,
    producer: { id: s.producer.userId, name: s.producer.name },
    active: true,
    addresses: [
      ...stamped.flatMap((a) =>
        addressIdsIn(a.value).map((addressId) => ({ addressId, role: a.role })),
      ),
      ...mailing,
    ],
  });

  await deps.addresses.track.setActive(ctx, { kind: "submission", id: s.id }, false);
}
