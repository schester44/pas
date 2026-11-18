export type CoverageAmount =
  | { kind: "money"; amount: string; currency: string }
  | { kind: "percent"; value: string };

export interface CoverageOptionSet {
  options: CoverageAmount[];
  defaultIndex: number;
}

export type CoverageAttachment = { level: "policy" } | { level: "exposure"; path: string };

export interface CoverageDefinition {
  code: string;
  name: string;
  description?: string;
  attachesTo: CoverageAttachment;
  required: boolean;
  limitOptions?: CoverageOptionSet;
  deductibleOptions?: CoverageOptionSet;
  dependsOn: string[];
}
