import type { FieldKind, GroupNode, SchemaNode } from "@pas/forms-core";
import { type EnrichmentPlan, enrichmentStages, type ProviderCapability } from "./plan";

const f = (key: string, label: string, kind: FieldKind = "number"): SchemaNode =>
  ({ key, label, kind }) as SchemaNode;

const money = (key: string, label: string): SchemaNode => ({
  key,
  label,
  kind: "money",
  currency: "USD",
});

/**
 * The normalized fields each capability answers with. Adapters map their vendor's payload onto
 * these, so plans, mappings and report templates are checked against one vocabulary.
 */
export const CAPABILITY_FIELDS: Record<ProviderCapability, SchemaNode[]> = {
  geocode: [
    f("latitude", "Latitude"),
    f("longitude", "Longitude"),
    f("stateFips", "State FIPS", "text"),
    f("countyFips", "County FIPS", "text"),
    f("countyName", "County", "text"),
    f("placeFips", "Place FIPS", "text"),
    f("placeName", "Place", "text"),
  ],
  property_characteristics: [
    f("yearBuilt", "Year built", "integer"),
    f("squareFeet", "Square feet", "integer"),
    f("stories", "Stories", "integer"),
    f("constructionType", "Construction", "text"),
    f("roofType", "Roof type", "text"),
    f("roofYear", "Roof year", "integer"),
  ],
  hazard_scores: [
    f("wildfireScore", "Wildfire score", "integer"),
    f("windScore", "Wind score", "integer"),
    f("hailScore", "Hail score", "integer"),
    f("hurricaneScore", "Hurricane score", "integer"),
    f("earthquakeScore", "Earthquake score", "integer"),
    f("crimeScore", "Crime score", "integer"),
    f("floodZone", "Flood zone", "text"),
    f("distanceToCoastMiles", "Distance to coast (miles)"),
    f("fireStationDistanceMiles", "Distance to fire station (miles)"),
    f("protectionClass", "Protection class", "integer"),
  ],
  tax_jurisdiction: [
    f("taxDistrictCode", "Tax district", "text"),
    f("municipality", "Municipality", "text"),
    f("insideCityLimits", "Inside city limits", "boolean"),
  ],
  replacement_cost: [
    money("replacementCost", "Estimated replacement cost"),
    money("insurableReplacementCost", "Insurable replacement cost"),
    money("exclusions", "Total exclusions"),
    money("costPerSquareFoot", "Cost per square foot"),
    f("squareFeet", "Square feet", "integer"),
    f("quality", "Quality", "text"),
    f("valuationId", "Valuation ID", "text"),
    {
      key: "breakdown",
      label: "Cost breakdown",
      kind: "repeatable",
      children: [
        f("component", "Component", "text"),
        money("amount", "Amount"),
        f("excluded", "Excluded", "boolean"),
      ],
    },
  ],
};

/** The plan's sources as a schema group, so templates and editors can address them. */
export function enrichmentSchema(plan: EnrichmentPlan): GroupNode {
  const calls = enrichmentStages.flatMap((stage) => plan.stages[stage] ?? []);

  return {
    key: "enrichment",
    label: "Data enrichment",
    kind: "group",
    children: [
      {
        key: "call",
        label: "Provider data",
        kind: "group",
        children: calls.map((call) => ({
          key: call.id,
          label: call.id,
          kind: "group" as const,
          children: CAPABILITY_FIELDS[call.capability],
        })),
      },
      {
        key: "transform",
        label: "Transformed data",
        kind: "group",
        children: plan.transforms.map((transform) => ({
          key: transform.id,
          label: transform.id,
          kind: "group" as const,
          children: transform.writes.map((field) => f(field, field, "text")),
        })),
      },
      {
        key: "derived",
        label: "Derived values",
        kind: "group",
        children: plan.derivations.map((d) => ({
          ...f(d.id, d.label ?? d.id, d.kind ?? "number"),
          ...(d.kind === "money" && { currency: "USD" }),
        })),
      },
    ],
  };
}

const ADDRESS_PARTS = ["street", "city", "state", "postalCode"];

/** The request fields adapters read for each capability; a call maps each to a risk path. */
export const CAPABILITY_REQUEST_FIELDS: Record<ProviderCapability, readonly string[]> = {
  geocode: ["address", ...ADDRESS_PARTS],
  property_characteristics: ["address", ...ADDRESS_PARTS],
  hazard_scores: ["latitude", "longitude", ...ADDRESS_PARTS],
  tax_jurisdiction: ["address", ...ADDRESS_PARTS],
  replacement_cost: [
    ...ADDRESS_PARTS,
    "yearBuilt",
    "squareFeet",
    "constructionType",
    "stories",
    "quality",
    "roofType",
  ],
};
