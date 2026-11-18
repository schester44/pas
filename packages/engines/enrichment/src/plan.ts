import { z } from "zod";

export const enrichmentStages = ["prefill", "pre_rate", "pre_bind", "renewal"] as const;
export type EnrichmentStage = (typeof enrichmentStages)[number];

export const providerCapabilities = [
  "geocode",
  "property_characteristics",
  "hazard_scores",
  "tax_jurisdiction",
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
  response: z.record(z.string(), riskPath).describe("Provider response field → risk path"),
  mode: z.enum(enrichmentModes),
  cacheTtl: cacheTtl.optional(),
  consent: z.enum(consentKinds).optional(),
  costClass: z.enum(costClasses),
  timeoutMs: z.number().int().positive().default(5000),
});

export const enrichmentPlanSchema = z.object({
  stages: z.partialRecord(z.enum(enrichmentStages), z.array(enrichmentCallSchema)),
});

export type EnrichmentCall = z.infer<typeof enrichmentCallSchema>;
export type EnrichmentPlan = z.infer<typeof enrichmentPlanSchema>;
