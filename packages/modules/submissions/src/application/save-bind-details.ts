import { invalid, type TenantContext, type UnitOfWork, type ClockProvider } from "@pas/kernel";
import type { AddressValue } from "@pas/forms-core";
import {
  type BindDetails,
  type CompletedBy,
  homeStateOf,
  isCompleteAddress,
} from "../domain/bind-details";
import type { SubmissionScope } from "../domain/scope";
import type { AddressRegistry } from "../ports/address-registry";
import type { ProductCatalog } from "../ports/product-catalog";
import type { QuoteRepository } from "../ports/quote-repository";
import type { SubmissionRepository } from "../ports/submission-repository";
import { completionRulesFor } from "./client-requests";
import { type QuoteDto, toQuoteDto } from "./quote-dto";
import { loadQuote } from "./quoting";

export type BindDetailsInput = Omit<BindDetails, "acknowledgements"> & {
  acknowledgements: string[];
};

/**
 * Saves the legal and compliance details. Where the producer accepts the disclosures, accepting one
 * is timestamped here; where the insured does, the producer's save leaves them untouched.
 */
export function makeSaveBindDetails(deps: {
  uow: UnitOfWork;
  submissions: SubmissionRepository;
  quotes: QuoteRepository;
  clocks: ClockProvider;
  addresses: AddressRegistry;
  catalog: ProductCatalog;
}) {
  const resolved = async (ctx: TenantContext, address: AddressValue | null) =>
    address && isCompleteAddress(address)
      ? (await deps.addresses.resolve(ctx, address)).value
      : address;

  return async function saveBindDetails(
    ctx: TenantContext,
    scope: SubmissionScope,
    input: { submissionId: string; details: BindDetailsInput },
  ): Promise<QuoteDto> {
    const rules = await completionRulesFor(deps, ctx, scope, input.submissionId);

    const [mailingAddress, ...interestAddresses] = await Promise.all([
      resolved(ctx, input.details.mailingAddress),
      ...input.details.additionalInterests.map((i) => resolved(ctx, i.address)),
    ]);

    return deps.uow.run(ctx, async (tx) => {
      const { submission, quote } = await loadQuote(deps, tx, ctx, scope, input.submissionId);
      const previous = quote.toSnapshot().details?.acknowledgements ?? [];
      const now = deps.clocks.forTenant(ctx.tenantId).now().toString();
      const offered = new Set(quote.toSnapshot().evaluation.attestations.map((a) => a.code));

      const country = submission.toSnapshot().jurisdiction.country;
      const homeState = homeStateOf(input.details, country);

      if (homeState && !homeState.startsWith(`${country}-`)) {
        throw invalid(`The home state must be in ${country}`, { field: "homeState" });
      }

      const details: BindDetails = {
        ...input.details,
        ...(homeState && { homeState }),
        mailingAddress: mailingAddress ?? null,
        additionalInterests: input.details.additionalInterests.map((interest, i) => ({
          ...interest,
          address: interestAddresses[i] ?? null,
        })),
        namedInsureds: input.details.namedInsureds.map((name) => name.trim()).filter(Boolean),
        acknowledgements:
          rules.disclosures === "insured"
            ? previous
            : [...new Set(input.details.acknowledgements)]
                .filter((code) => offered.has(code))
                .map(
                  (code) =>
                    previous.find((ack) => ack.code === code) ?? {
                      code,
                      acceptedAt: now,
                      by: producerOf(ctx, input.details.producer.name),
                    },
                ),
      };

      quote.saveDetails(details, deps.clocks.forTenant(ctx.tenantId));
      await deps.quotes.save(tx, quote);

      return toQuoteDto(quote, submission, "producer");
    });
  };
}

const producerOf = (ctx: TenantContext, name: string): CompletedBy => ({
  party: "producer",
  name,
  ...(ctx.actor.type === "user" && { userId: ctx.actor.userId }),
});

export type SaveBindDetails = ReturnType<typeof makeSaveBindDetails>;
