import { z } from "zod";

export const enrichmentStages = ["prefill", "pre_rate", "pre_bind", "renewal"] as const;
export type EnrichmentStage = (typeof enrichmentStages)[number];

export const providerCapabilities = [
  "geocode",
  "property_characteristics",
  "hazard_scores",
  "tax_jurisdiction",
  "replacement_cost",
] as const;
export type ProviderCapability = (typeof providerCapabilities)[number];

export const enrichmentModes = ["prefill", "authoritative", "uw_only"] as const;
export type EnrichmentMode = (typeof enrichmentModes)[number];

export const costClasses = ["free", "low", "medium", "high"] as const;
export type CostClass = (typeof costClasses)[number];

export const consentKinds = ["consumer_report"] as const;
export type ConsentKind = (typeof consentKinds)[number];

const riskPath = z.string().min(1);

export function cacheTtlSeconds(iso: string): number {
  return Temporal.Duration.from(iso).total("seconds");
}

const cacheTtl = z.string().refine((value) => {
  try {
    return cacheTtlSeconds(value) > 0;
  } catch {
    return false;
  }
}, "Expected a positive ISO-8601 duration in days or smaller units, such as P30D");

export const enrichmentCallSchema = z.object({
  id: z.string().min(1),
  capability: z.enum(providerCapabilities),
  providers: z.array(z.string().min(1)).min(1).describe("Primary first, then ordered fallbacks"),
  request: z.record(z.string(), riskPath).describe("Provider request field → risk path"),
  optional: z
    .array(z.string().min(1))
    .default([])
    .describe("Request fields sent only when filled; the call still runs without them"),
  response: z.record(z.string(), riskPath).describe("Provider response field → risk path"),
  mode: z.enum(enrichmentModes),
  cacheTtl: cacheTtl.optional(),
  consent: z.enum(consentKinds).optional(),
  costClass: z.enum(costClasses),
  timeoutMs: z.number().int().positive().default(5000),
  combine: z
    .enum(["fallback", "merge"])
    .default("fallback")
    .describe("fallback: first provider that answers; merge: ask all and merge field by field"),
  fieldSources: z
    .record(z.string(), z.string().min(1))
    .default({})
    .describe(
      "Response field → provider that wins it; otherwise first non-empty in provider order",
    ),
  dependsOn: z
    .array(z.string().min(1))
    .default([])
    .describe("Calls whose results this call's request reads, such as geocode before hazards"),
});

const key = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/, "Letters, digits and underscores");

/** `call.<callId>.<field>`, `transform.<id>.<field>` or `derived.<id>`, plus any nested path. */
export const SOURCE_KINDS = ["call", "transform", "derived"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const sourceRefSchema = z
  .string()
  .regex(
    /^(call|transform)\.[A-Za-z][A-Za-z0-9_]*\.[^.].*$|^derived\.[A-Za-z][A-Za-z0-9_]*(\..+)?$/,
    "Expected call.<call>.<field>, transform.<transform>.<field> or derived.<value>",
  );

export const transformFailurePolicies = ["block", "skip"] as const;

export const enrichmentTransformSchema = z.object({
  id: key,
  stage: z.enum(enrichmentStages),
  extension: z.object({
    key: z.string().min(1),
    version: z.string().min(1).optional().describe("Pinned when the product version is published"),
  }),
  reads: z.array(sourceRefSchema).default([]),
  writes: z.array(key).min(1),
  onFailure: z.enum(transformFailurePolicies).default("block"),
  timeoutMs: z.number().int().positive().default(2000),
});

export const derivationKinds = [
  "number",
  "integer",
  "money",
  "percent",
  "text",
  "boolean",
  "date",
] as const;

export const enrichmentDerivationSchema = z.object({
  id: key,
  stage: z.enum(enrichmentStages),
  label: z.string().optional(),
  kind: z.enum(derivationKinds).optional().describe("How reports and screens format the value"),
  expression: z.string().min(1).describe("Reads call.*, transform.*, derived.* and risk.*"),
});

export const enrichmentMappingSchema = z.object({
  from: sourceRefSchema,
  to: riskPath,
  mode: z.enum(enrichmentModes),
});

export const reportSources = ["vendor", "template", "vendor_then_template"] as const;
export type ReportSource = (typeof reportSources)[number];

export const enrichmentReportSchema = z.object({
  id: key,
  title: z.string().min(1),
  stage: z.enum(enrichmentStages),
  source: z.enum(reportSources),
  callId: z.string().min(1).optional().describe("The call whose provider supplies the report"),
  template: z.string().min(1).optional().describe("An enrichment_report document template key"),
});

export const enrichmentPlanSchema = z.object({
  stages: z.partialRecord(z.enum(enrichmentStages), z.array(enrichmentCallSchema)).default({}),
  transforms: z.array(enrichmentTransformSchema).default([]),
  derivations: z.array(enrichmentDerivationSchema).default([]),
  mappings: z.array(enrichmentMappingSchema).default([]),
  reports: z.array(enrichmentReportSchema).default([]),
});

export type EnrichmentCall = z.infer<typeof enrichmentCallSchema>;
export type EnrichmentTransform = z.infer<typeof enrichmentTransformSchema>;
export type EnrichmentDerivation = z.infer<typeof enrichmentDerivationSchema>;
export type EnrichmentMapping = z.infer<typeof enrichmentMappingSchema>;
export type EnrichmentReport = z.infer<typeof enrichmentReportSchema>;
export type EnrichmentPlan = z.infer<typeof enrichmentPlanSchema>;
export type EnrichmentPlanInput = z.input<typeof enrichmentPlanSchema>;

export const emptyEnrichmentPlan = (): EnrichmentPlan => enrichmentPlanSchema.parse({});

export function enrichmentPlanOf(stored: unknown): EnrichmentPlan {
  return stored ? enrichmentPlanSchema.parse(stored) : emptyEnrichmentPlan();
}

export const isEmptyPlan = (plan: EnrichmentPlan) =>
  Object.values(plan.stages).every((calls) => !calls?.length) && plan.derivations.length === 0;

/** The stage that produces a source ref, or undefined when nothing in the plan produces it. */
export function stageOfRef(plan: EnrichmentPlan, ref: string): EnrichmentStage | undefined {
  const [kind, id] = ref.split(".");

  if (kind === "call") {
    return enrichmentStages.find((stage) => plan.stages[stage]?.some((call) => call.id === id));
  }

  if (kind === "transform") return plan.transforms.find((t) => t.id === id)?.stage;

  if (kind === "derived") return plan.derivations.find((d) => d.id === id)?.stage;

  return undefined;
}

/** Call-level `response` maps are shorthand for mappings from `call.<id>.<field>`. */
export function mappingsOf(plan: EnrichmentPlan): EnrichmentMapping[] {
  const shorthand = enrichmentStages.flatMap((stage) =>
    (plan.stages[stage] ?? []).flatMap((call) =>
      Object.entries(call.response).map(([field, to]) => ({
        from: `call.${call.id}.${field}`,
        to,
        mode: call.mode,
      })),
    ),
  );

  return [...shorthand, ...plan.mappings];
}
