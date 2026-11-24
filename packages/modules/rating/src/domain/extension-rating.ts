import type { PointOutputs } from "@pas/extension-points";
import { currencyDecimals } from "@pas/forms-core";
import { Money } from "@pas/kernel";
import {
  type RaterSource,
  RatingError,
  type RatingInput,
  type RatingResult,
} from "@pas/rating-engine";

export type ExtensionRaterSource = Extract<RaterSource, { engine: "extension" }>;

const keyOf = (line: { coverage: string; exposure?: string }) =>
  `${line.coverage}\u0000${line.exposure ?? ""}`;

/**
 * Turns an extension's `rate` output into a RatingResult. Every selected coverage must be priced
 * exactly once and nothing else may be: an extension can't add or drop coverage by pricing it.
 */
export function ratingResultFromExtension(
  source: ExtensionRaterSource,
  input: RatingInput,
  output: PointOutputs["rate"],
): RatingResult {
  if (input.currency !== source.currency) {
    throw new RatingError(
      `The extension rater prices in ${source.currency}, not ${input.currency}`,
    );
  }

  const places = currencyDecimals(source.currency);
  const selected = new Set(input.coverages.map(keyOf));
  const priced = new Set<string>();

  const coverages = output.coverages.map((line) => {
    const key = keyOf(line);

    if (!selected.has(key)) {
      throw new RatingError(`The extension priced ${line.coverage}, which isn't selected`, {
        coverage: line.coverage,
      });
    }

    if (priced.has(key)) {
      throw new RatingError(`The extension priced ${line.coverage} twice`, {
        coverage: line.coverage,
      });
    }

    priced.add(key);

    const premium = Money.of(line.premium, source.currency);

    // Premiums flow into taxes, invoices and proration; a sub-cent amount would be guessed at later.
    if (!premium.round(places).equals(premium)) {
      throw new RatingError(
        `The extension's premium for ${line.coverage} has more than ${places} decimals`,
        { coverage: line.coverage },
      );
    }

    if (premium.isNegative()) {
      throw new RatingError(`The extension's premium for ${line.coverage} is negative`, {
        coverage: line.coverage,
      });
    }

    return {
      coverage: line.coverage,
      ...(line.exposure !== undefined && { exposure: line.exposure }),
      premium,
      calculated: premium,
    };
  });

  const missing = input.coverages.find((c) => !priced.has(keyOf(c)));

  if (missing) {
    throw new RatingError(`The extension didn't price ${missing.coverage}`, {
      coverage: missing.coverage,
    });
  }

  return {
    currency: source.currency,
    coverages,
    adjustments: [],
    factors: output.factors,
    total: coverages.reduce((sum, line) => sum.plus(line.premium), Money.zero(source.currency)),
    warnings: output.warnings,
    worksheet: [],
    artifact: {
      kind: "extension",
      key: source.extensionVersionId,
      version: source.extensionVersionId,
    },
  };
}
