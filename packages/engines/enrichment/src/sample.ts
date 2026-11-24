import { evaluate } from "@pas/expressions";
import { type EnrichmentPlan, enrichmentStages } from "./plan";
import { sampleProviderResponse } from "./providers/fake";
import type { EnrichmentSources } from "./run-stage";

/** Plausible sources for a plan, for template previews and the admin's "try it". */
export function sampleSources(
  plan: EnrichmentPlan,
  risk: Record<string, unknown> = {},
): EnrichmentSources {
  const call = Object.fromEntries(
    enrichmentStages.flatMap((stage) =>
      (plan.stages[stage] ?? []).map((c) => [
        c.id,
        sampleProviderResponse(c.capability, { sample: c.id }),
      ]),
    ),
  );

  const transform = Object.fromEntries(
    plan.transforms.map((t) => [t.id, Object.fromEntries(t.writes.map((field) => [field, null]))]),
  );

  const derived: Record<string, unknown> = {};

  for (const d of plan.derivations) {
    try {
      derived[d.id] = evaluate(d.expression, { call, transform, derived, risk });
    } catch {
      derived[d.id] = null;
    }
  }

  return { call, transform, derived };
}
