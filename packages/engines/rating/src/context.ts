import { getAt } from "@pas/forms-core";
import { Decimal } from "decimal.js";
import { RatingError, type CoverageSelection, type RatingInput } from "./contract";

export const CONTEXT_ROOTS = [
  "risk",
  "exposure",
  "coverage",
  "coverages",
  "term",
  "transaction",
  "enrichment",
  "jurisdiction",
] as const;

export type RatingContext = Record<(typeof CONTEXT_ROOTS)[number], unknown>;

const amount = (value: string | undefined) => (value === undefined ? undefined : Number(value));

function coverageView(selection: CoverageSelection) {
  return {
    ...selection.options,
    code: selection.coverage,
    selected: true,
    limit: amount(selection.limit),
    deductible: amount(selection.deductible),
  };
}

export function ratingContext(
  input: RatingInput,
  exposure: string | undefined,
  coverage?: CoverageSelection,
): RatingContext {
  const coverages: Record<string, unknown> = {};

  for (const selection of input.coverages) {
    if (selection.exposure === undefined || selection.exposure === exposure) {
      if (selection.exposure === undefined && coverages[selection.coverage]) continue;

      coverages[selection.coverage] = coverageView(selection);
    }
  }

  const effective = Temporal.PlainDate.from(input.term.effective);
  const expiration = Temporal.PlainDate.from(input.term.expiration);

  return {
    risk: input.risk,
    exposure: exposure === undefined ? undefined : getAt(input.risk, exposure),
    coverage: coverage ? coverageView(coverage) : undefined,
    coverages,
    term: {
      effective: input.term.effective,
      expiration: input.term.expiration,
      days: effective.until(expiration, { largestUnit: "days" }).days,
    },
    transaction: input.transaction,
    enrichment: input.enrichment ?? {},
    jurisdiction: input.jurisdiction,
  };
}

export function readPath(context: RatingContext, path: string): unknown {
  return getAt(context, path);
}

export function exposuresOf(input: RatingInput): (string | undefined)[] {
  return [...new Set(input.coverages.map((selection) => selection.exposure))];
}

// Excel and ZEN compute in binary floating point; 15 significant digits is what Excel itself keeps.
export function fromFloat(value: number): Decimal {
  return new Decimal(Number(value.toPrecision(15)));
}

export function toDecimal(value: unknown, label: string): Decimal {
  if (value instanceof Decimal) return value;

  if (typeof value === "number" && Number.isFinite(value)) return fromFloat(value);

  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    return new Decimal(value.trim());
  }

  throw new RatingError(`${label} isn't a number`, { label, value: String(value) });
}
