import { type DocumentSet, emptyDocumentSet } from "@pas/documents";
import type { FormDefinition, RiskSchema } from "@pas/forms-core";
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

export interface VersionContents {
  riskSchema: RiskSchema;
  forms: VersionForm[];
  coverages: CoverageDefinition[];
  availability: AvailabilityWindow[];
  lifecycle: Record<string, unknown>;
  documents: DocumentSet;
}

export function emptyContents(): VersionContents {
  return {
    riskSchema: { fields: [] },
    forms: [],
    coverages: [],
    availability: [],
    lifecycle: {},
    documents: emptyDocumentSet(),
  };
}
