import {
  type CarrierOutcome,
  carrierAssignmentOf,
  delegates,
  type FetchedDocument,
  type OwnershipMatrix,
} from "@pas/carriers";
import { DomainError, Money, newId, type TenantContext } from "@pas/kernel";
import type { BillingMethodOption } from "../domain/billing-methods";
import type { SubmissionScope } from "../domain/scope";
import type { PaymentMethodInput } from "../ports/payment-gateway";
import type { IssuedPolicy, TimelineActor } from "../ports/policy-issuer";
import type { CatalogRelease } from "../ports/product-catalog";
import {
  attachPacket,
  type BindDeps,
  type BindQuoteResult,
  dto,
  issueRequest,
  trackPolicyAddresses,
} from "./bind-quote";
import { carrierInputFor } from "./carrier-input";
import { JOURNEY_EVENTS } from "./quote-journey";
import { loadQuote } from "./quoting";

const SYSTEM_SCOPE: SubmissionScope = { kind: "tenant" };
const CARRIER_ACTOR: TimelineActor = { type: "system", name: "Carrier bind" };

export interface CarrierPacket {
  documents: FetchedDocument[];
  source: OwnershipMatrix["documents"]["source"];
  order: OwnershipMatrix["documents"]["order"];
  merge: (parts: readonly Uint8Array[]) => Promise<Uint8Array>;
}

export const carrierBinds = (release: CatalogRelease) => {
  const assignment = carrierAssignmentOf(release.lifecycle);

  return assignment !== null && delegates(assignment.ownership, "new_business");
};

const pdfs = (documents: readonly FetchedDocument[]) =>
  documents.filter((d) => d.contentType.includes("pdf")).map((d) => d.body);

/** Tenant, carrier or both, merged into one packet in the configured order (PLAN §12). */
export async function carrierPacket(
  packet: CarrierPacket,
  tenantPdf: Uint8Array,
): Promise<Uint8Array> {
  const carrier = pdfs(packet.documents);

  if (packet.source === "tenant" || carrier.length === 0) return tenantPdf;

  if (packet.source === "carrier") return packet.merge(carrier);

  return packet.merge(
    packet.order === "carrier_first" ? [...carrier, tenantPdf] : [tenantPdf, ...carrier],
  );
}

export async function storeCarrierDocuments(
  deps: Pick<BindDeps, "storage">,
  ctx: TenantContext,
  issued: IssuedPolicy,
  packet: CarrierPacket | undefined,
) {
  if (!packet) return [];

  return Promise.all(
    packet.documents.map(async (doc, i) => {
      const key = `tenants/${ctx.tenantId}/policies/${issued.policyId}/${issued.transactionId}/carrier-${i + 1}.pdf`;

      await deps.storage.put({ key, body: doc.body, contentType: doc.contentType });

      return {
        kind: "carrier_document",
        title: doc.title,
        storageKey: key,
        sizeBytes: doc.body.byteLength,
      };
    }),
  );
}

/**
 * The carrier owns new business (PLAN §12): authorize the payment, then hand the bind to the
 * carrier's flow. The quote sits in `pending_carrier` until the carrier answers.
 */
export async function submitBindToCarrier(
  deps: BindDeps,
  ctx: TenantContext,
  scope: SubmissionScope,
  input: {
    submissionId: string;
    method?: PaymentMethodInput;
    billingMethod: BillingMethodOption["method"];
    actor: TimelineActor;
    release: CatalogRelease;
    productName: string;
  },
): Promise<BindQuoteResult> {
  const carrierGateway = deps.carrier!;

  if (input.billingMethod !== "direct") {
    throw new DomainError(
      "precondition_failed",
      "When the carrier binds, pay by card; agency and mortgagee bill aren't offered on carrier-bound business yet",
      { reason: "billing_method_unavailable" },
    );
  }

  if (!input.method) throw new DomainError("invalid", "Pay by card to bind");

  const { submission, quote } = await deps.uow.run(ctx, (tx) =>
    loadQuote(deps, tx, ctx, scope, input.submissionId),
  );

  const q = quote.toSnapshot();
  const carrier = q.evaluation.carrier;

  if (!carrier)
    throw new DomainError("precondition_failed", "Get the carrier's quote first", {
      reason: "carrier_quote_missing",
    });

  if (carrier.bind?.status === "pending_carrier")
    return { status: "pending_carrier", quote: dto(quote, submission) };

  const offer = quote.selectedPayPlan();

  const amount = offer
    ? Money.of(offer.dueToday.amount, offer.dueToday.currency)
    : q.evaluation.total;

  const payments = await deps.payments.for(ctx);

  const authorization = await payments.authorize(ctx, {
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
        input.actor,
        deps.clocks.forTenant(ctx.tenantId),
      );

      await deps.quotes.save(tx, current.quote);
    });

    return {
      status: "payment_declined",
      message: authorization.message,
      quote: dto(quote, submission),
    };
  }

  const { flowRunId } = await carrierGateway.start(ctx, {
    carrier: carrier.carrier,
    capability: "bind",
    subject: { kind: "new_business", quoteId: q.id, submissionId: q.submissionId, phase: "bind" },
    input: carrierInputFor({
      capability: "bind",
      quote,
      submission,
      release: input.release,
      productName: input.productName,
    }),
    idempotencyKey: `bind:${q.id}:r${q.revision}:${authorization.authorizationId}`,
  });

  const submitted = await deps.uow.run(ctx, async (tx) => {
    const current = await loadQuote(deps, tx, ctx, scope, input.submissionId);

    current.quote.submitToCarrier(
      {
        phase: "bind",
        flowRunId,
        reference: carrier.reference,
        billingMethod: "direct",
        payment: {
          authorizationId: authorization.authorizationId,
          provider: payments.provider,
          amount: amount.toJSON(),
          brand: authorization.method.brand,
          last4: authorization.method.last4,
          expMonth: authorization.method.expMonth,
          expYear: authorization.method.expYear,
        },
      },
      deps.clocks.forTenant(ctx.tenantId),
    );

    await deps.quotes.save(tx, current.quote);

    return current;
  });

  return { status: "pending_carrier", quote: dto(submitted.quote, submitted.submission) };
}

/**
 * Applies a finished bind or issue flow: bind → issue (when the connector has it) → the policy
 * is issued here with the carrier's number and documents, then the payment is captured. Any
 * failure voids the authorization and leaves the quote quoted with the carrier's reason.
 */
export type ContinueCarrierBindDeps = Pick<
  BindDeps,
  | "uow"
  | "outbox"
  | "quotes"
  | "submissions"
  | "catalog"
  | "payments"
  | "policies"
  | "documents"
  | "storage"
  | "journey"
  | "clocks"
  | "addresses"
> & { carrier: NonNullable<BindDeps["carrier"]> };

export function makeContinueCarrierBind(deps: ContinueCarrierBindDeps) {
  return async function continueCarrierBind(
    ctx: TenantContext,
    input: {
      quoteId: string;
      submissionId: string;
      phase: "bind" | "issue";
      flowRunId: string;
      outcome: CarrierOutcome;
      error: string | null;
      capabilities: readonly string[];
    },
  ): Promise<{ status: "bound" | "issuing" | "failed" | "stale" }> {
    const clock = deps.clocks.forTenant(ctx.tenantId);

    const { submission, quote } = await deps.uow.run(ctx, (tx) =>
      loadQuote(deps, tx, ctx, SYSTEM_SCOPE, input.submissionId),
    );

    const q = quote.toSnapshot();
    const carrier = q.evaluation.carrier;
    const bind = carrier?.bind;

    if (
      !carrier ||
      !bind ||
      bind.status !== "pending_carrier" ||
      bind.flowRunId !== input.flowRunId
    ) {
      return { status: "stale" };
    }

    const fail = async (message: string) => {
      if (bind.payment) {
        await (
          await deps.payments.for(ctx)
        ).void(ctx, { authorizationId: bind.payment.authorizationId });
      }

      const failed = await deps.uow.run(ctx, async (tx) => {
        const current = await loadQuote(deps, tx, ctx, SYSTEM_SCOPE, input.submissionId);

        current.quote.carrierFailed(message, clock);
        await deps.quotes.save(tx, current.quote);

        return current.quote;
      });

      await deps.journey.signal(ctx, failed, JOURNEY_EVENTS.changed, { carrier: "failed" });

      return { status: "failed" as const };
    };

    const ok = input.outcome.status !== "failed" && input.outcome.status !== "declined";

    if (!ok) {
      return fail(
        input.outcome.messages.map((m) => m.text).join("; ") ||
          input.error ||
          "The carrier didn't bind",
      );
    }

    const [release, productName] = await Promise.all([
      deps.catalog.getRelease(ctx, q.productReleaseId),
      deps.catalog.productName(ctx, submission.toSnapshot().productId),
    ]);

    const reference = input.outcome.reference ?? bind.reference;

    if (input.phase === "bind" && input.capabilities.includes("issue")) {
      const issuing = carrierInputFor({
        capability: "issue",
        quote,
        submission,
        release,
        productName,
      });

      const { flowRunId } = await deps.carrier.start(ctx, {
        carrier: carrier.carrier,
        capability: "issue",
        subject: {
          kind: "new_business",
          quoteId: q.id,
          submissionId: q.submissionId,
          phase: "issue",
        },
        input: { ...issuing, carrier: { ...(reference && { reference }) } },
        idempotencyKey: `issue:${q.id}:${input.flowRunId}`,
      });

      await deps.uow.run(ctx, async (tx) => {
        const current = await loadQuote(deps, tx, ctx, SYSTEM_SCOPE, input.submissionId);

        current.quote.submitToCarrier({ ...bind, phase: "issue", flowRunId, reference }, clock);
        await deps.quotes.save(tx, current.quote);
      });

      return { status: "issuing" };
    }

    const ownership = carrierAssignmentOf(release.lifecycle)!.ownership;
    const carrierNumber = input.outcome.policyNumber ?? null;
    const history = await deps.uow.run(ctx, (tx) => deps.quotes.listActivity(tx, ctx, quote.id));
    const offer = quote.selectedPayPlan();
    const plan = offer ? (release.billing.payPlans.find((p) => p.key === offer.key) ?? null) : null;

    const issued = await deps.policies.issue(ctx, {
      ...issueRequest(quote, submission, release, productName),
      ...(ownership.policyNumber === "carrier" && carrierNumber && { policyNumber: carrierNumber }),
      billing: { method: "direct", payPlan: plan, dunning: release.billing.dunning },
      actor: CARRIER_ACTOR,
      history: history.map((entry) => ({
        type: entry.type,
        occurredAt: entry.occurredAt.toString(),
        actor: entry.actor,
        summary: entry.summary,
        data: entry.data,
      })),
    });

    const payment = bind.payment;
    const payments = await deps.payments.for(ctx);

    if (payment) {
      const amount = Money.of(payment.amount.amount, payment.amount.currency);

      await payments.capture(ctx, { authorizationId: payment.authorizationId, amount });

      await deps.policies.applyPayment(ctx, {
        invoiceId: issued.invoice.id,
        amount: payment.amount,
        provider: payment.provider,
        providerRef: payment.authorizationId,
        method: { brand: payment.brand, last4: payment.last4 },
        methodLabel: `${payment.brand} ending ${payment.last4}`,
        actor: CARRIER_ACTOR,
      });
    }

    await trackPolicyAddresses(deps, ctx, { quote, submission, release, policy: issued });

    const documents = await deps.carrier.documents(ctx, {
      flowRunId: input.flowRunId,
      documents: input.outcome.documents,
    });

    await attachPacket(deps, ctx, {
      quote,
      submission,
      release,
      productName,
      issued,
      carrier: { documents, ...ownership.documents, merge: deps.carrier.mergePdfs },
    });

    await deps.carrier.linkPolicy(ctx, {
      carrier: carrier.carrier,
      policyId: issued.policyId,
      quoteId: q.id,
      carrierPolicyNumber: carrierNumber,
      carrierReference: reference,
    });

    const bound = await deps.uow.run(ctx, async (tx) => {
      const current = await loadQuote(deps, tx, ctx, SYSTEM_SCOPE, input.submissionId);
      const now = clock.now();

      current.quote.note(
        "carrier_confirmed",
        { type: "system", name: carrier.name },
        `${carrier.name} issued${carrierNumber ? ` ${carrierNumber}` : ""}`,
        { carrierPolicyNumber: carrierNumber, reference },
        clock,
      );

      current.quote.carrierIssued(clock);

      current.quote.markBound(
        {
          policy: { id: issued.policyId, number: issued.policyNumber },
          payment: payment && {
            paymentId: payment.authorizationId,
            provider: payment.provider,
            amount: Money.of(payment.amount.amount, payment.amount.currency),
            brand: payment.brand,
            last4: payment.last4,
            capturedAt: now,
          },
        },
        clock,
      );

      await deps.quotes.save(tx, current.quote);

      if (payment) {
        await deps.quotes.savePayment(tx, ctx, {
          id: newId(),
          quoteId: current.quote.id,
          provider: payment.provider,
          providerRef: payment.authorizationId,
          status: "captured",
          amount: Money.of(payment.amount.amount, payment.amount.currency),
          method: {
            brand: payment.brand,
            last4: payment.last4,
            expMonth: payment.expMonth,
            expYear: payment.expYear,
          },
          failure: null,
          recordedAt: now,
        });
      }

      await deps.outbox.add(tx, current.quote.pullEvents());

      return current.quote;
    });

    await deps.journey.signal(ctx, bound, JOURNEY_EVENTS.changed);

    return { status: "bound" };
  };
}

export type ContinueCarrierBind = ReturnType<typeof makeContinueCarrierBind>;
