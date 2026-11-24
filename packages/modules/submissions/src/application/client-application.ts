import {
  asId,
  type ClockProvider,
  DomainError,
  Money,
  notFound,
  type Outbox,
  type TenantContext,
  type UnitOfWork,
} from "@pas/kernel";
import type { CompletedBy } from "../domain/bind-details";
import type { ClientRequest } from "../domain/client-request";
import { assertCompletes, type CompletionRules, completionRules } from "../domain/completion";
import type { PaymentMethodInput } from "../ports/payment-gateway";
import type { ClientLinks } from "../ports/client-links";
import type { ClientRequestRepository } from "../ports/client-request-repository";
import type { ProductCatalog } from "../ports/product-catalog";
import type { QuoteRepository } from "../ports/quote-repository";
import type { SubmissionRepository } from "../ports/submission-repository";
import type { Quote } from "../domain/quote";
import type { SubmissionScope } from "../domain/scope";
import type { Submission } from "../domain/submission";
import type { BindQuote } from "./bind-quote";
import { namedInsuredOf } from "./document-context";
import { AUTOPAY_CONSENT, ESIGN_CONSENT } from "./esign-consent";
import type { RenderQuotePacket } from "./render-quote-packet";
import type { SignQuote } from "./sign-quote";

/** The insured as their verified session knows them. */
export interface ClientIdentity {
  userId: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

type MoneyDto = { amount: string; currency: string };

export interface ClientApplicationDto {
  request: { status: string; name: string; email: string; sentBy: string };
  rules: CompletionRules;
  quote: {
    submissionId: string;
    submissionNumber: string;
    productName: string;
    insuredName: string;
    namedInsureds: string[];
    term: { start: string; end: string };
    expiresAt: string;
    status: string;
    revision: number;
    updatedAt: string;
    coverages: { code: string; name: string; premium: MoneyDto }[];
    premium: { written: MoneyDto; taxesFees: MoneyDto; total: MoneyDto };
    payPlan: { label: string; dueToday: MoneyDto; installments: number } | null;
    policy: { id: string; number: string } | null;
  };
  disclosures: {
    code: string;
    title: string;
    statement: string;
    acceptedAt: string | null;
    acceptedBy: string | null;
  }[];
  signature: { signerName: string; signedAt: string } | null;
  signatureConsent: string;
  autopayConsent: string;
  paid: boolean;
}

export type ClientLinkPeek =
  | { status: "invalid" }
  | {
      status: "sent" | "opened" | "completed" | "revoked" | "expired";
      emailHint: string;
      agent: string;
    };

const hint = (email: string) => {
  const [local = "", domain = ""] = email.split("@");

  return `${local.slice(0, 1)}${"•".repeat(Math.max(local.length - 1, 2))}@${domain}`;
};

const notYours = () =>
  new DomainError(
    "forbidden",
    "This link was sent to a different email address. Sign in with the address your agent used.",
    { reason: "wrong_client" },
  );

const sum = (amounts: readonly Money[], currency: string): Money =>
  amounts.reduce((total, m) => total.plus(m), Money.zero(currency));

/**
 * The insured's side of the application, reached through a link the producer sent. The link names
 * the request; the verified session must belong to the address it went to. Each step then runs the
 * producer's own use case under the submission's producer scope, as the insured.
 */
export function makeClientApplication(deps: {
  uow: UnitOfWork;
  outbox: Outbox;
  submissions: SubmissionRepository;
  quotes: QuoteRepository;
  catalog: ProductCatalog;
  requests: ClientRequestRepository;
  links: ClientLinks;
  clocks: ClockProvider;
  sign: SignQuote;
  bind: BindQuote;
  packet: RenderQuotePacket;
}) {
  async function find(ctx: TenantContext, token: string): Promise<ClientRequest | null> {
    const id = deps.links.verify(token);

    if (!id) return null;

    return deps.uow.run(ctx, (tx) => deps.requests.findById(tx, ctx, asId<"ClientRequest">(id)));
  }

  async function open(ctx: TenantContext, token: string, identity: ClientIdentity) {
    const request = await find(ctx, token);

    if (!request) {
      throw new DomainError(
        "not_found",
        "This link isn't valid. Use the link in your agent's email.",
        {
          reason: "invalid_link",
        },
      );
    }

    if (!identity.emailVerified || !request.isFor(identity.email)) throw notYours();

    const r = request.toSnapshot();
    const scope: SubmissionScope = { kind: "producer", producerId: asId(r.producerId) };

    const loaded = await deps.uow.run(ctx, async (tx) => {
      const submission = await deps.submissions.findById(tx, ctx, scope, asId(r.submissionId));
      const quote = submission && (await deps.quotes.findBySubmission(tx, ctx, submission.id));

      return submission && quote ? { submission, quote } : null;
    });

    if (!loaded) throw notFound("Application", r.submissionId);

    const release = await deps.catalog.getRelease(ctx, loaded.quote.toSnapshot().productReleaseId);

    return { request, ...loaded, scope, rules: completionRules(release.lifecycle) };
  }

  const by = (identity: ClientIdentity, name = identity.name): CompletedBy => ({
    party: "insured",
    name: name || identity.email,
    email: identity.email,
    userId: identity.userId,
  });

  async function view(
    ctx: TenantContext,
    request: ClientRequest,
    submission: Submission,
    quote: Quote,
    rules: CompletionRules,
  ): Promise<ClientApplicationDto> {
    const q = quote.toSnapshot();
    const r = request.toSnapshot();
    const e = q.evaluation;
    const currency = e.total.currency;
    const accepted = new Map(q.details?.acknowledgements.map((a) => [a.code, a]));
    const signature = q.signature?.revision === q.revision ? q.signature : null;
    const plan = e.payPlans.find((p) => p.key === q.payPlan) ?? e.payPlans.find((p) => p.isDefault);
    const productName = await deps.catalog.productName(ctx, submission.toSnapshot().productId);

    const status =
      quote.status === "bound"
        ? "completed"
        : request.status(deps.clocks.forTenant(ctx.tenantId).now());

    return {
      request: { status, name: r.name, email: r.email, sentBy: r.sentBy.name },
      rules,
      quote: {
        submissionId: q.submissionId,
        submissionNumber: q.submissionNumber,
        productName,
        insuredName: namedInsuredOf(quote),
        namedInsureds: q.details?.namedInsureds ?? [],
        term: { start: q.termStart.toString(), end: q.termEnd.toString() },
        expiresAt: q.expiresAt.toString(),
        status: quote.status,
        revision: q.revision,
        updatedAt: q.updatedAt.toString(),
        coverages: [...new Set(e.premium.map((line) => line.coverage))].map((code) => ({
          code,
          name: e.offers.find((o) => o.code === code)?.name ?? code,
          premium: sum(
            e.premium.filter((line) => line.coverage === code).map((line) => line.premium),
            currency,
          ).toJSON(),
        })),
        premium: {
          written: e.writtenPremium.toJSON(),
          taxesFees: sum(
            e.taxesFees.map((t) => t.amount),
            currency,
          ).toJSON(),
          total: e.total.toJSON(),
        },
        payPlan: plan
          ? { label: plan.label, dueToday: plan.dueToday, installments: plan.installments }
          : null,
        policy: q.policy,
      },
      disclosures: e.attestations.map((a) => {
        const ack = accepted.get(a.code);

        return {
          code: a.code,
          title: a.title,
          statement: a.statement,
          acceptedAt: ack?.acceptedAt ?? null,
          acceptedBy: ack?.by?.name ?? null,
        };
      }),
      signature: signature && {
        signerName: signature.signerName,
        signedAt: signature.signedAt.toString(),
      },
      signatureConsent: ESIGN_CONSENT,
      autopayConsent: AUTOPAY_CONSENT,
      paid: q.payment !== null || quote.status === "bound",
    };
  }

  /** Marks the request done once nothing the insured owns is left. */
  function finishedFor(quote: Quote, rules: CompletionRules): boolean {
    const open = quote.requirements().filter((r) => r.blocking && !r.satisfied);

    const owned = (kind: string) =>
      (kind === "attestation" && rules.disclosures === "insured") ||
      (kind === "signature" && rules.signature === "insured") ||
      (kind === "payment" && rules.payment === "insured");

    return quote.status === "bound" || !open.some((r) => owned(r.kind));
  }

  async function settle(ctx: TenantContext, token: string, identity: ClientIdentity) {
    const loaded = await open(ctx, token, identity);
    const clock = deps.clocks.forTenant(ctx.tenantId);

    if (finishedFor(loaded.quote, loaded.rules)) {
      loaded.request.complete(clock);
      await deps.uow.run(ctx, (tx) => deps.requests.save(tx, loaded.request));
    }

    return view(ctx, loaded.request, loaded.submission, loaded.quote, loaded.rules);
  }

  return {
    /** Before sign-in: whether the link works, and a hint of the address it went to. */
    async peek(ctx: TenantContext, input: { token: string }): Promise<ClientLinkPeek> {
      const request = await find(ctx, input.token);

      if (!request) return { status: "invalid" };

      const r = request.toSnapshot();

      return {
        status: request.status(deps.clocks.forTenant(ctx.tenantId).now()),
        emailHint: hint(r.email),
        agent: r.sentBy.name,
      };
    },

    async get(
      ctx: TenantContext,
      input: { token: string; identity: ClientIdentity },
    ): Promise<ClientApplicationDto> {
      const { request, submission, quote, rules } = await open(ctx, input.token, input.identity);

      if (request.markOpened(deps.clocks.forTenant(ctx.tenantId))) {
        await deps.uow.run(ctx, (tx) => deps.requests.save(tx, request));
      }

      return view(ctx, request, submission, quote, rules);
    },

    async acceptDisclosures(
      ctx: TenantContext,
      input: { token: string; identity: ClientIdentity; codes: string[] },
    ): Promise<ClientApplicationDto> {
      const { request, submission, rules } = await open(ctx, input.token, input.identity);
      const clock = deps.clocks.forTenant(ctx.tenantId);

      request.assertUsable(clock);
      assertCompletes(rules, "disclosures", "insured");

      await deps.uow.run(ctx, async (tx) => {
        const quote = await deps.quotes.findBySubmission(tx, ctx, submission.id);

        if (!quote) throw notFound("Quote", submission.id);

        quote.acceptDisclosures(input.codes, by(input.identity), clock);
        await deps.quotes.save(tx, quote);
        await deps.outbox.add(tx, quote.pullEvents());
      });

      return settle(ctx, input.token, input.identity);
    },

    async packet(ctx: TenantContext, input: { token: string; identity: ClientIdentity }) {
      const { request, scope } = await open(ctx, input.token, input.identity);

      return deps.packet(ctx, scope, { submissionId: request.toSnapshot().submissionId });
    },

    async sign(
      ctx: TenantContext,
      input: {
        token: string;
        identity: ClientIdentity;
        typedName: string;
        agreed: boolean;
        ipAddress: string;
        userAgent: string;
      },
    ): Promise<ClientApplicationDto> {
      const { request, scope } = await open(ctx, input.token, input.identity);

      request.assertUsable(deps.clocks.forTenant(ctx.tenantId));

      const { name: _name, ...signer } = by(input.identity);

      await deps.sign(ctx, scope, {
        submissionId: request.toSnapshot().submissionId,
        typedName: input.typedName,
        agreed: input.agreed,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        signer,
      });

      return settle(ctx, input.token, input.identity);
    },

    async pay(
      ctx: TenantContext,
      input: {
        token: string;
        identity: ClientIdentity;
        method: PaymentMethodInput;
        autopay: boolean;
      },
    ): Promise<{ status: string; message?: string; application: ClientApplicationDto }> {
      const { request, scope } = await open(ctx, input.token, input.identity);

      request.assertUsable(deps.clocks.forTenant(ctx.tenantId));

      const result = await deps.bind(ctx, scope, {
        submissionId: request.toSnapshot().submissionId,
        method: input.method,
        billingMethod: "direct",
        actorName: input.identity.name || input.identity.email,
        autopay: input.autopay,
        payer: "insured",
      });

      return {
        status: result.status,
        ...(result.status === "payment_declined" && { message: result.message }),
        application: await settle(ctx, input.token, input.identity),
      };
    },
  };
}

export type ClientApplication = ReturnType<typeof makeClientApplication>;
