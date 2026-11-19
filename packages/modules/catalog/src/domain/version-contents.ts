import type { DecisionKind, JdmDecision } from "@pas/decisions-engine";
import { type DocumentSet, emptyDocumentSet } from "@pas/documents";
import type { FormDefinition, RiskSchema } from "@pas/forms-core";
import { type BillingConfig, emptyBillingConfig } from "@pas/pay-plans";
import type { RatingConfig } from "@pas/rating-engine";
import type { AvailabilityWindow } from "./availability";
import type { CoverageDefinition } from "./coverage";

export const FORM_CHANNELS = ["agent", "customer", "internal"] as const;
export const FORM_STAGES = ["quote", "bind", "endorsement"] as const;

export type FormChannel = (typeof FORM_CHANNELS)[number];
export type FormStage = (typeof FORM_STAGES)[number];

export interface VersionForm {
  channel: FormChannel;
  stage: FormStage;
  form: FormDefinition;
}

export interface DecisionTest {
  id: string;
  name: string;
  input: Record<string, unknown>;
  expected: unknown;
}

/** One decision artifact, addressed as `kind.key` (e.g. `underwriting.main`). */
export interface VersionDecision {
  kind: DecisionKind;
  key: string;
  name: string;
  decision: JdmDecision;
  tests: DecisionTest[];
}

export const decisionRef = (decision: Pick<VersionDecision, "kind" | "key">) =>
  `${decision.kind}.${decision.key}`;

export interface VersionContents {
  riskSchema: RiskSchema;
  forms: VersionForm[];
  coverages: CoverageDefinition[];
  availability: AvailabilityWindow[];
  lifecycle: Record<string, unknown>;
  documents: DocumentSet;
  rules: VersionDecision[];
  rating: RatingConfig | null;
  billing: BillingConfig;
}

export function emptyContents(): VersionContents {
  return {
    riskSchema: { fields: [] },
    forms: [],
    coverages: [],
    availability: [],
    lifecycle: {},
    documents: emptyDocumentSet(),
    rules: [],
    rating: null,
    billing: emptyBillingConfig(),
  };
}
