import type { CanonicalInput, Capability } from "@pas/carriers";
import { mailingAddressOf } from "../domain/insured";
import type { Quote } from "../domain/quote";
import type { Submission } from "../domain/submission";
import type { CatalogRelease } from "../ports/product-catalog";
import { namedInsuredOf } from "./document-context";

/** A quote in the canonical carrier model: what connector mappings read as `input`. */
export function carrierInputFor(input: {
  capability: Capability;
  quote: Quote;
  submission: Submission;
  release: CatalogRelease;
  productName: string;
  policy?: { id: string; number: string };
}): CanonicalInput {
  const q = input.quote.toSnapshot();
  const s = input.submission.toSnapshot();
  const names = new Map(input.release.coverages.map((c) => [c.code, c.name]));
  const carrier = q.evaluation.carrier;

  return {
    capability: input.capability,
    product: {
      id: s.productId,
      name: input.productName,
      version: input.release.version,
      releaseId: q.productReleaseId,
    },
    jurisdiction: s.jurisdiction,
    term: { effectiveDate: q.termStart.toString(), expirationDate: q.termEnd.toString() },
    policy: input.policy ? { id: input.policy.id, number: input.policy.number } : {},
    quote: { id: q.id, number: q.submissionNumber, revision: q.revision },
    insured: {
      name: namedInsuredOf(input.quote),
      mailingAddress: q.details?.mailingAddress ?? mailingAddressOf(q.riskData),
    },
    producer: { name: s.producer.name, agency: s.producer.agencyId },
    risk: q.riskData,
    coverages: q.selection.map((choice) => {
      const line = q.evaluation.premium.find(
        (p) => p.coverage === choice.coverage && p.exposure === choice.exposure,
      );

      return {
        code: choice.coverage,
        name: names.get(choice.coverage) ?? choice.coverage,
        ...(choice.exposure !== undefined && { exposure: choice.exposure }),
        ...(choice.limit && { limit: choice.limit }),
        ...(choice.deductible && { deductible: choice.deductible }),
        ...(line && { premium: line.premium.toJSON() }),
      };
    }),
    premium: {
      written: q.evaluation.writtenPremium.toJSON(),
      taxesFees: q.evaluation.taxesFees.map((t) => ({
        code: t.code,
        label: t.label,
        amount: t.amount.toJSON(),
      })),
      total: q.evaluation.total.toJSON(),
    },
    carrier: { ...(carrier?.reference && { reference: carrier.reference }) },
  };
}
