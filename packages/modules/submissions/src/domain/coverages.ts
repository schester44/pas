import type { DecisionResult } from "@pas/decisions-engine";
import type { CoverageAmount, CoverageLike } from "@pas/documents";
import { getAt } from "@pas/forms-core";
import { invalid } from "@pas/kernel";

export interface CoverageDefinition extends CoverageLike {
  description?: string;
  dependsOn: string[];
}

/** What the insured may choose for one coverage, after the `coverage_options` decision. */
export interface CoverageOffer {
  code: string;
  name: string;
  description?: string;
  required: boolean;
  dependsOn: string[];
  attachesTo: CoverageLike["attachesTo"];
  limits: CoverageAmount[];
  defaultLimit: number;
  deductibles: CoverageAmount[];
  defaultDeductible: number;
}

export interface CoverageChoice {
  coverage: string;
  exposure?: string;
  limit?: CoverageAmount;
  deductible?: CoverageAmount;
}

type OptionsDecision = DecisionResult<"coverage_options">["coverages"];

export const amountKey = (amount: CoverageAmount) =>
  amount.kind === "money" ? amount.amount : `${amount.value}%`;

const sameAmount = (a: CoverageAmount | undefined, b: CoverageAmount | undefined) =>
  a !== undefined && b !== undefined && amountKey(a) === amountKey(b);

function restrict(
  options: CoverageAmount[],
  defaultIndex: number,
  decided: { options: (string | number)[]; default?: string | number } | undefined,
): { options: CoverageAmount[]; defaultIndex: number } {
  const fallback = options[defaultIndex];

  if (!decided) return { options, defaultIndex: Math.max(0, defaultIndex) };

  const allowed = new Set(decided.options.map(String));
  const kept = allowed.size > 0 ? options.filter((o) => allowed.has(amountKey(o))) : options;
  const preferred = decided.default === undefined ? fallback : undefined;

  const index = kept.findIndex((o) =>
    preferred ? sameAmount(o, preferred) : amountKey(o) === String(decided.default),
  );

  return { options: kept, defaultIndex: Math.max(0, index) };
}

/** The release's coverages narrowed by the `coverage_options` decision (keyed by coverage code). */
export function coverageOffers(
  definitions: readonly CoverageDefinition[],
  decided: OptionsDecision,
): CoverageOffer[] {
  return definitions.map((definition) => {
    const limits = restrict(
      definition.limitOptions?.options ?? [],
      definition.limitOptions?.defaultIndex ?? 0,
      decided[definition.code],
    );

    const deductibles = restrict(
      definition.deductibleOptions?.options ?? [],
      definition.deductibleOptions?.defaultIndex ?? 0,
      undefined,
    );

    return {
      code: definition.code,
      name: definition.name,
      ...(definition.description && { description: definition.description }),
      required: definition.required,
      dependsOn: definition.dependsOn,
      attachesTo: definition.attachesTo,
      limits: limits.options,
      defaultLimit: limits.defaultIndex,
      deductibles: deductibles.options,
      defaultDeductible: deductibles.defaultIndex,
    };
  });
}

export function exposuresOf(offer: CoverageOffer, risk: Record<string, unknown>): string[] {
  if (offer.attachesTo.level === "policy") return [];

  const path = offer.attachesTo.path;
  const entries = getAt(risk, path);
  const count = Array.isArray(entries) ? entries.length : 1;

  return Array.from({ length: count }, (_, index) => `${path}[${index}]`);
}

function defaultChoice(offer: CoverageOffer, exposure: string | undefined): CoverageChoice {
  return {
    coverage: offer.code,
    ...(exposure !== undefined && { exposure }),
    ...(offer.limits[offer.defaultLimit] && { limit: offer.limits[offer.defaultLimit] }),
    ...(offer.deductibles[offer.defaultDeductible] && {
      deductible: offer.deductibles[offer.defaultDeductible],
    }),
  };
}

function choicesFor(offer: CoverageOffer, risk: Record<string, unknown>) {
  const exposures = exposuresOf(offer, risk);

  return exposures.length === 0 ? [undefined] : exposures;
}

/** The default package: every required coverage at its default limit and deductible. */
export function defaultSelection(
  offers: readonly CoverageOffer[],
  risk: Record<string, unknown>,
): CoverageChoice[] {
  return offers
    .filter((offer) => offer.required)
    .flatMap((offer) => choicesFor(offer, risk).map((exposure) => defaultChoice(offer, exposure)));
}

/** Checks a customized selection against the offers and returns it in canonical order. */
export function normalizeSelection(
  offers: readonly CoverageOffer[],
  choices: readonly CoverageChoice[],
  risk: Record<string, unknown>,
): CoverageChoice[] {
  const byCode = new Map(offers.map((offer) => [offer.code, offer]));

  for (const choice of choices) {
    if (!byCode.has(choice.coverage)) {
      throw invalid(`${choice.coverage} isn't offered on this quote`, {
        coverage: choice.coverage,
      });
    }
  }

  const selected: CoverageChoice[] = [];

  for (const offer of offers) {
    for (const exposure of choicesFor(offer, risk)) {
      const choice = choices.find((c) => c.coverage === offer.code && c.exposure === exposure);

      if (!choice) {
        if (offer.required) selected.push(defaultChoice(offer, exposure));

        continue;
      }

      selected.push(checkedChoice(offer, choice, exposure));
    }
  }

  for (const choice of selected) {
    const offer = byCode.get(choice.coverage)!;

    for (const dependency of offer.dependsOn) {
      const met = selected.some(
        (other) =>
          other.coverage === dependency &&
          (other.exposure === undefined || other.exposure === choice.exposure),
      );

      if (!met) {
        throw invalid(`${offer.name} needs ${byCode.get(dependency)?.name ?? dependency}`, {
          coverage: offer.code,
          dependsOn: dependency,
        });
      }
    }
  }

  return selected;
}

function checkedChoice(
  offer: CoverageOffer,
  choice: CoverageChoice,
  exposure: string | undefined,
): CoverageChoice {
  const pick = (
    value: CoverageAmount | undefined,
    options: CoverageAmount[],
    fallback: number,
    label: string,
  ) => {
    if (options.length === 0) return undefined;

    if (value === undefined) return options[fallback];

    const match = options.find((option) => sameAmount(option, value));

    if (!match) {
      throw invalid(`${amountKey(value)} isn't an available ${label} for ${offer.name}`, {
        coverage: offer.code,
      });
    }

    return match;
  };

  const limit = pick(choice.limit, offer.limits, offer.defaultLimit, "limit");

  const deductible = pick(
    choice.deductible,
    offer.deductibles,
    offer.defaultDeductible,
    "deductible",
  );

  return {
    coverage: offer.code,
    ...(exposure !== undefined && { exposure }),
    ...(limit && { limit }),
    ...(deductible && { deductible }),
  };
}
