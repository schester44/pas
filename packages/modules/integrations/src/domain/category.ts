export const INTEGRATION_CATEGORIES = [
  "payments",
  "esign",
  "email",
  "sms",
  "print_mail",
  "data",
  "address",
  "licensing",
  "filing",
  "carrier",
  "billing",
  "llm",
] as const;

export type IntegrationCategory = (typeof INTEGRATION_CATEGORIES)[number];

export type IntegrationEnvironment = "test" | "live";

/**
 * Each category powers one port. Data and address providers chain in order (a suggestion-only
 * address provider sits above the verifier); every other port has one active provider.
 */
export const allowsSeveral = (category: IntegrationCategory) =>
  category === "data" || category === "address" || category === "filing";

/** What the domain needs to know about a catalog provider. */
export interface ProviderRules {
  readonly id: string;
  readonly category: IntegrationCategory;
  readonly testMode: boolean;
  readonly liveMode: boolean;
  readonly builtin: boolean;
  readonly requiredSecrets: readonly string[];
}

/** Sandboxes never reach a live account: only test-mode environments of providers that have one. */
export const usableInSandbox = (provider: ProviderRules, environment: IntegrationEnvironment) =>
  environment === "test" && provider.testMode;
