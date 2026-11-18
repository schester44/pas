import {
  contractFields,
  DECISION_KIND_KEYS,
  type DecisionKind,
  type DecisionResult,
  evaluateDecision,
  type JdmDecision,
} from "@pas/decisions-engine";
import { sampleRisk } from "@pas/documents";
import type { RiskSchema, SchemaNode } from "@pas/forms-core";
import { subdivisionsOf } from "@pas/ui/lib/jurisdictions";
import type { Contents, DecisionTest, VersionDecision } from "@/components/catalog/version-editor";
import { humanize, newId, tableDecision } from "@/components/decisions/jdm-edit";
import { OUTCOMES } from "@/components/decisions/results";

export const KIND_COPY: Record<DecisionKind, string> = {
  underwriting: "Refers, declines or asks for more information about a risk.",
  eligibility: "Decides whether a risk can be quoted at all.",
  coverage_options: "Sets the limits and deductibles offered, and their defaults.",
  taxes_fees: "Adds taxes, surcharges and fees on top of the premium.",
  form_schedule: "Chooses the forms attached to the policy.",
  notice_rules: "Sets notice periods, reasons and delivery for cancellations.",
  cancellation_terms: "Sets the refund method, minimum earned premium and fully earned fees.",
  dea: "Says when a surplus lines diligent search is required.",
  attestations: "Lists the statements the insured must confirm before binding.",
  referral_triggers: "Flags conditions that need an underwriter's review.",
  custom: "Returns any output for lifecycle settings to use.",
};

export const KIND_ORDER = DECISION_KIND_KEYS;

export const decisionRef = (decision: Pick<VersionDecision, "kind" | "key">) =>
  `${decision.kind}.${decision.key}`;

export function blankDecision(kind: DecisionKind, name: string): JdmDecision {
  const fields = contractFields(kind).filter((field) => field.required);
  const outputs = fields.length > 0 ? fields.map((field) => field.key) : ["result"];

  return tableDecision(name, {
    hitPolicy:
      kind === "dea" || kind === "notice_rules" || kind === "cancellation_terms"
        ? "first"
        : "collect",
    inputs: [],
    outputs: outputs.map((field) => ({ id: newId(), name: humanize(field), field })),
    rules: [],
  });
}

/** The risk schema plus the jurisdiction decisions are evaluated for. */
export function decisionSchema(contents: Contents): RiskSchema {
  const countries = [...new Set(contents.availability.map((w) => w.jurisdiction.country))];

  const jurisdiction: SchemaNode = {
    key: "jurisdiction",
    kind: "group",
    label: "Jurisdiction",
    children: [
      {
        key: "country",
        kind: "enum",
        label: "Country",
        options: (countries.length ? countries : ["US"]).map((code) => ({
          value: code,
          label: code,
        })),
      },
      {
        key: "subdivision",
        kind: "enum",
        label: "State",
        options: (countries.length ? countries : ["US"]).flatMap((code) =>
          subdivisionsOf(code).map(([value, label]) => ({ value, label })),
        ),
      },
    ],
  };

  return { fields: [...contents.riskSchema.fields, jurisdiction] };
}

export function decisionSample(contents: Contents): Record<string, unknown> {
  const window = contents.availability[0];
  const jurisdiction = window?.jurisdiction ?? { country: "US" };
  const effective = window?.newBusiness.from ?? Temporal.Now.plainDateISO().toString();

  return { ...sampleRisk(contents.riskSchema, jurisdiction, effective), jurisdiction };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);

  if (value === null || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .toSorted()
      .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
  );
}

export const sameResult = (a: unknown, b: unknown) =>
  JSON.stringify(canonical(a ?? null)) === JSON.stringify(canonical(b ?? null));

export type Evaluated = { status: "ok"; result: unknown } | { status: "error"; message: string };

export function evaluate(
  kind: DecisionKind,
  decision: JdmDecision,
  input: Record<string, unknown>,
): Evaluated {
  try {
    const { result } = evaluateDecision(kind, decision, input);

    return { status: "ok", result: JSON.parse(JSON.stringify(result ?? null)) };
  } catch (error) {
    return { status: "error", message: (error as Error).message };
  }
}

export type TestRun = { passed: boolean; actual: Evaluated };

export function runTest(decision: VersionDecision, test: DecisionTest): TestRun {
  const actual = evaluate(decision.kind, decision.decision, test.input);

  return { passed: actual.status === "ok" && sameResult(actual.result, test.expected), actual };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function summarize(kind: DecisionKind, result: unknown): string {
  if (result === null || result === undefined) return "No result";

  switch (kind) {
    case "underwriting":
    case "eligibility": {
      const r = result as DecisionResult<"underwriting">;
      const codes = r.outcomes.filter((o) => o.outcome !== "pass").map((o) => o.reasonCode);

      return [OUTCOMES[r.overall].label, ...codes].join(" · ");
    }
    case "taxes_fees": {
      const lines = (result as DecisionResult<"taxes_fees">).lines;

      return lines.length ? lines.map((line) => line.code).join(", ") : "No taxes or fees";
    }
    case "dea": {
      const dea = result as DecisionResult<"dea">;

      if (!dea) return "No result";

      return dea.required
        ? `Required · ${plural(dea.declinationsRequired, "declination")}${dea.timing ? ` · ${humanize(dea.timing).toLowerCase()}` : ""}`
        : "Not required";
    }
    case "coverage_options":
      return plural(
        Object.keys((result as DecisionResult<"coverage_options">).coverages).length,
        "coverage",
      );
    case "form_schedule":
      return plural((result as DecisionResult<"form_schedule">).documents.length, "document");
    case "referral_triggers":
      return plural((result as DecisionResult<"referral_triggers">).triggers.length, "trigger");
    case "attestations":
      return plural((result as DecisionResult<"attestations">).attestations.length, "attestation");
    case "notice_rules": {
      const notice = result as DecisionResult<"notice_rules">;

      return notice ? `${notice.minDaysNotice} days notice` : "No result";
    }
    case "cancellation_terms": {
      const terms = result as DecisionResult<"cancellation_terms">;

      if (!terms) return "No result";

      return terms.minimumEarnedType
        ? `${terms.minimumEarnedType === "percent" ? `${terms.minimumEarnedValue}%` : terms.minimumEarnedValue} minimum earned`
        : "Pro rata";
    }
    case "custom":
      return JSON.stringify(result).slice(0, 80);
  }
}
