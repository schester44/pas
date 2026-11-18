import {
  type AddressValue,
  type FieldNode,
  getAt,
  type RiskSchema,
  type SchemaNode,
} from "@pas/forms-core";
import type {
  CoverageLike,
  DocumentContext,
  FormsScheduleRow,
  Jurisdiction,
  SelectedCoverage,
} from "./context";
import type { TransactionType } from "./model";

export interface SampleInput {
  schema: RiskSchema;
  coverages: readonly CoverageLike[];
  selected?: readonly string[];
  tenant: DocumentContext["tenant"];
  carrier?: { name: string };
  product: DocumentContext["product"];
  jurisdiction: Jurisdiction;
  jurisdictionName: string;
  transaction?: TransactionType;
  effectiveDate?: string;
  forms?: FormsScheduleRow[];
}

const FIRST = "Jordan";
const LAST = "Avery";

function address(jurisdiction: Jurisdiction): AddressValue {
  return {
    line1: "1200 Harbor View Drive",
    city: "Springfield",
    region: jurisdiction.subdivision?.split("-")[1] ?? "",
    postalCode: "12345",
    country: jurisdiction.country,
  };
}

function sampleField(field: FieldNode, jurisdiction: Jurisdiction, effectiveDate: string): unknown {
  const key = field.key.toLowerCase();

  switch (field.kind) {
    case "text":
      if (key.includes("first")) return FIRST;

      if (key.includes("last")) return LAST;

      if (key.includes("name")) return `${FIRST} ${LAST}`;

      return field.label;
    case "email":
      return `${FIRST}.${LAST}@example.com`.toLowerCase();
    case "phone":
      return "(555) 010-4477";
    case "integer":
      if (key.includes("year")) return 1998;

      return /claim|loss|count|violation/.test(key) ? 0 : 2;
    case "number":
      return 3.5;
    case "money":
      return "350000";
    case "percent":
      return "10";
    case "date":
      return effectiveDate;
    case "boolean":
      return true;
    case "enum":
      return field.options?.[0]?.value;
    case "multi_enum":
      return field.options?.[0] ? [field.options[0].value] : [];
    case "address":
      return address(jurisdiction);
    case "file":
      return undefined;
  }
}

function sampleNodes(
  nodes: readonly SchemaNode[],
  jurisdiction: Jurisdiction,
  effectiveDate: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const node of nodes) {
    if (node.kind === "group") {
      out[node.key] = sampleNodes(node.children, jurisdiction, effectiveDate);
    } else if (node.kind === "repeatable") {
      out[node.key] = Array.from({ length: Math.max(node.minItems ?? 0, 1) }, () =>
        sampleNodes(node.children, jurisdiction, effectiveDate),
      );
    } else {
      const value = sampleField(node, jurisdiction, effectiveDate);

      if (value !== undefined) out[node.key] = value;
    }
  }

  return out;
}

/** Plausible risk data for previews and simulators: every field filled. */
export function sampleRisk(
  schema: RiskSchema,
  jurisdiction: Jurisdiction,
  effectiveDate: string,
): Record<string, unknown> {
  return sampleNodes(schema.fields, jurisdiction, effectiveDate);
}

const pickDefault = (set: CoverageLike["limitOptions"]) => set?.options[set.defaultIndex];

export function selectCoverages(
  coverages: readonly CoverageLike[],
  risk: Record<string, unknown>,
  selected: readonly string[],
): SelectedCoverage[] {
  return coverages
    .filter((coverage) => selected.includes(coverage.code))
    .flatMap((coverage) => {
      const base = {
        code: coverage.code,
        name: coverage.name,
        limit: pickDefault(coverage.limitOptions),
        deductible: pickDefault(coverage.deductibleOptions),
      };

      if (coverage.attachesTo.level === "policy") return [base];

      const path = coverage.attachesTo.path;
      const entries = getAt(risk, path);
      const count = Array.isArray(entries) ? entries.length : 1;

      return Array.from({ length: count }, (_, index) => ({ ...base, exposure: { path, index } }));
    });
}

/** A plausible context for previews: every field filled, default limits, no premium yet. */
export function sampleContext(input: SampleInput): DocumentContext {
  const today = Temporal.Now.plainDateISO();
  const effective = input.effectiveDate ? Temporal.PlainDate.from(input.effectiveDate) : today;
  const effectiveDate = effective.toString();
  const risk = sampleRisk(input.schema, input.jurisdiction, effectiveDate);
  const selected = input.selected ?? input.coverages.map((coverage) => coverage.code);

  return {
    tenant: input.tenant,
    ...(input.carrier && { carrier: input.carrier }),
    product: input.product,
    policy: {
      number: "SAMPLE-000123",
      effectiveDate,
      expirationDate: effective.add({ years: 1 }).toString(),
      issuedDate: effective.subtract({ days: 14 }).toString(),
      jurisdiction: input.jurisdiction,
      jurisdictionName: input.jurisdictionName,
      transaction: input.transaction ?? "new_business",
    },
    namedInsured: { name: `${FIRST} ${LAST}`, mailingAddress: address(input.jurisdiction) },
    producer: { name: "Morgan Lee", agency: "Harbor Insurance Agency", phone: "(555) 010-2200" },
    risk,
    coverages: selectCoverages(input.coverages, risk, selected),
    forms: input.forms ?? [],
  };
}
