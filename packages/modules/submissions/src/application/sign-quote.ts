import {
  conflict,
  invalid,
  type TenantContext,
  type UnitOfWork,
  type ClockProvider,
  type Outbox,
  type ProviderFor,
} from "@pas/kernel";
import type { ObjectStorage } from "@pas/storage";
import type { CompletedBy } from "../domain/bind-details";
import { outstandingFor } from "../domain/bind-requirements";
import { assertCompletes } from "../domain/completion";
import type { SubmissionScope } from "../domain/scope";
import type { ESignGateway } from "../ports/esign-gateway";
import type { ProductCatalog } from "../ports/product-catalog";
import type { QuoteRepository } from "../ports/quote-repository";
import type { SubmissionRepository } from "../ports/submission-repository";
import { namedInsuredOf } from "./document-context";
import { completionRulesFor } from "./client-requests";
import { ESIGN_CONSENT } from "./esign-consent";
import { type QuoteDto, toQuoteDto } from "./quote-dto";
import { loadQuote } from "./quoting";
import type { RenderQuotePacket } from "./render-quote-packet";

const normalized = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

/** Embedded e-sign of the reviewed packet (PLAN §7.2.1 step 4). */
export function makeSignQuote(deps: {
  uow: UnitOfWork;
  outbox: Outbox;
  submissions: SubmissionRepository;
  quotes: QuoteRepository;
  catalog: ProductCatalog;
  renderPacket: RenderQuotePacket;
  esign: ProviderFor<ESignGateway>;
  storage: ObjectStorage;
  clocks: ClockProvider;
}) {
  return async function signQuote(
    ctx: TenantContext,
    scope: SubmissionScope,
    input: {
      submissionId: string;
      typedName: string;
      agreed: boolean;
      ipAddress: string;
      userAgent: string;
      signer: Omit<CompletedBy, "name">;
    },
  ): Promise<QuoteDto> {
    if (!input.agreed) throw invalid("Agree to the terms to sign", { field: "agreed" });

    const rules = await completionRulesFor(deps, ctx, scope, input.submissionId);

    assertCompletes(rules, "signature", input.signer.party);

    const { quote } = await deps.uow.run(ctx, (tx) =>
      loadQuote(deps, tx, ctx, scope, input.submissionId),
    );

    const open = outstandingFor(quote.requirements(), "sign");

    if (open.length > 0) {
      throw conflict(`Finish ${open.map((r) => r.title.toLowerCase()).join(", ")} first`, {
        reason: "requirements_open",
        requirements: open.map((r) => r.id),
      });
    }

    const signers = (quote.toSnapshot().details?.namedInsureds ?? []).map(normalized);

    if (!signers.includes(normalized(input.typedName))) {
      throw invalid(`Type the name of a named insured: ${namedInsuredOf(quote)}`, {
        field: "typedName",
      });
    }

    const packet = await deps.renderPacket(ctx, scope, input);
    const signedAt = deps.clocks.forTenant(ctx.tenantId).now();
    const q = quote.toSnapshot();

    const esign = await deps.esign.for(ctx);

    const signed = await esign.sign(
      ctx,
      {
        reference: q.id,
        title: `${q.submissionNumber} application`,
        document: packet.pdf,
        signer: { name: input.typedName.trim() },
      },
      {
        typedName: input.typedName.trim(),
        consent: ESIGN_CONSENT,
        signedAt,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
    );

    const documentKey = `tenants/${ctx.tenantId}/quotes/${q.id}/r${packet.revision}-signed.pdf`;

    await deps.storage.put({
      key: documentKey,
      body: signed.document,
      contentType: "application/pdf",
    });

    return deps.uow.run(ctx, async (tx) => {
      const current = await loadQuote(deps, tx, ctx, scope, input.submissionId);

      if (current.quote.toSnapshot().revision !== packet.revision) {
        throw conflict("The quote changed while you were signing; review it again", {
          reason: "revision_changed",
        });
      }

      current.quote.recordSignature(
        {
          provider: esign.provider,
          envelopeId: signed.envelopeId,
          signerName: input.typedName.trim(),
          signedAt,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
          consent: ESIGN_CONSENT,
          documentKey,
          documentSha256: signed.sha256,
          signer: { ...input.signer, name: input.typedName.trim() },
        },
        deps.clocks.forTenant(ctx.tenantId),
      );

      await deps.quotes.save(tx, current.quote);
      await deps.outbox.add(tx, current.quote.pullEvents());

      return toQuoteDto(current.quote, current.submission, "producer");
    });
  };
}

export type SignQuote = ReturnType<typeof makeSignQuote>;
