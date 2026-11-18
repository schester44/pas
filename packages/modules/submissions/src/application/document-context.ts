import type { SelectedCoverage } from "@pas/documents";
import type { PlainDate } from "@pas/kernel";
import { insuredNameOf, mailingAddressOf } from "../domain/insured";
import type { Quote } from "../domain/quote";
import type { Submission } from "../domain/submission";
import type { CatalogRelease } from "../ports/product-catalog";
import type { QuoteDocuments } from "../ports/quote-documents";

type PacketContext = Parameters<QuoteDocuments["render"]>[1]["context"];

function exposureRef(exposure: string | undefined) {
  const match = exposure ? /^(.*)\[(\d+)\]$/.exec(exposure) : null;

  return match ? { path: match[1]!, index: Number(match[2]) } : undefined;
}

export function namedInsuredOf(quote: Quote): string {
  const q = quote.toSnapshot();
  const names = q.details?.namedInsureds.filter(Boolean) ?? [];

  return names.length > 0 ? names.join(" and ") : (insuredNameOf(q.riskData) ?? "");
}

/** The document context for a quote's packet, from its real data and premium. */
export function quoteDocumentContext(input: {
  submission: Submission;
  quote: Quote;
  release: CatalogRelease;
  productName: string;
  policyNumber?: string;
  issuedDate: PlainDate;
}): PacketContext {
  const s = input.submission.toSnapshot();
  const q = input.quote.toSnapshot();
  const names = new Map(input.release.coverages.map((c) => [c.code, c.name]));

  const coverages: SelectedCoverage[] = q.selection.map((choice) => {
    const premium = q.evaluation.premium.find(
      (line) => line.coverage === choice.coverage && line.exposure === choice.exposure,
    );

    const exposure = exposureRef(choice.exposure);

    return {
      code: choice.coverage,
      name: names.get(choice.coverage) ?? choice.coverage,
      ...(exposure && { exposure }),
      ...(choice.limit && { limit: choice.limit }),
      ...(choice.deductible && { deductible: choice.deductible }),
      ...(premium && { premium: premium.premium.toJSON() }),
    };
  });

  const mailingAddress = q.details?.mailingAddress ?? mailingAddressOf(q.riskData);
  const producer = q.details?.producer ?? { name: s.producer.name };

  return {
    product: { name: input.productName, version: input.release.version },
    policy: {
      ...(input.policyNumber && { number: input.policyNumber }),
      effectiveDate: q.termStart.toString(),
      expirationDate: q.termEnd.toString(),
      issuedDate: input.issuedDate.toString(),
      jurisdiction: s.jurisdiction,
    },
    namedInsured: { name: namedInsuredOf(input.quote), ...(mailingAddress && { mailingAddress }) },
    producer: { name: producer.name, ...(producer.agency && { agency: producer.agency }) },
    risk: q.riskData,
    coverages,
    premium: { total: q.evaluation.writtenPremium.toJSON() },
  };
}
