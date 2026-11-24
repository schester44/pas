export const EXTENSION_POINTS = [
  "precommit",
  "validate",
  "rate",
  "underwrite",
  "document_select",
  "document_data",
  "installments",
  "cancellation_charges",
  "field_options",
  "field_prefill",
  "record_panel",
  "action",
  "automation",
] as const;

export type ExtensionPoint = (typeof EXTENSION_POINTS)[number];

export type FailurePolicy = "block" | "skip";

export interface PointSpec {
  label: string;
  defaultTimeoutMs: number;
  maxTimeoutMs: number;
  defaultFailure: FailurePolicy;
  /** A failure here must stop the operation: a guessed premium or underwriting outcome is worse than none. */
  failClosed: boolean;
  /** Bound per product version (pinned in the ProductRelease) rather than per tenant. */
  productBound: boolean;
  /** What a binding of this point attaches to. */
  target: "none" | "field" | "record";
}

export const POINT_SPECS: Record<ExtensionPoint, PointSpec> = {
  precommit: {
    label: "Prepare risk data",
    defaultTimeoutMs: 3_000,
    maxTimeoutMs: 10_000,
    defaultFailure: "block",
    failClosed: false,
    productBound: true,
    target: "none",
  },
  validate: {
    label: "Validate risk data",
    defaultTimeoutMs: 3_000,
    maxTimeoutMs: 10_000,
    defaultFailure: "block",
    failClosed: false,
    productBound: true,
    target: "none",
  },
  rate: {
    label: "Rate",
    defaultTimeoutMs: 5_000,
    maxTimeoutMs: 15_000,
    defaultFailure: "block",
    failClosed: true,
    productBound: true,
    target: "none",
  },
  underwrite: {
    label: "Underwrite",
    defaultTimeoutMs: 5_000,
    maxTimeoutMs: 15_000,
    defaultFailure: "block",
    failClosed: true,
    productBound: true,
    target: "none",
  },
  document_select: {
    label: "Select documents",
    defaultTimeoutMs: 10_000,
    maxTimeoutMs: 30_000,
    defaultFailure: "block",
    failClosed: false,
    productBound: true,
    target: "none",
  },
  document_data: {
    label: "Add document data",
    defaultTimeoutMs: 10_000,
    maxTimeoutMs: 30_000,
    defaultFailure: "block",
    failClosed: false,
    productBound: true,
    target: "none",
  },
  installments: {
    label: "Installment schedule",
    defaultTimeoutMs: 3_000,
    maxTimeoutMs: 10_000,
    defaultFailure: "block",
    failClosed: false,
    productBound: true,
    target: "none",
  },
  cancellation_charges: {
    label: "Cancellation charges",
    defaultTimeoutMs: 3_000,
    maxTimeoutMs: 10_000,
    defaultFailure: "block",
    failClosed: false,
    productBound: true,
    target: "none",
  },
  field_options: {
    label: "Field options",
    defaultTimeoutMs: 2_000,
    maxTimeoutMs: 5_000,
    defaultFailure: "skip",
    failClosed: false,
    productBound: true,
    target: "field",
  },
  field_prefill: {
    label: "Prefill fields",
    defaultTimeoutMs: 3_000,
    maxTimeoutMs: 10_000,
    defaultFailure: "skip",
    failClosed: false,
    productBound: true,
    target: "field",
  },
  record_panel: {
    label: "Record panel",
    defaultTimeoutMs: 3_000,
    maxTimeoutMs: 10_000,
    defaultFailure: "skip",
    failClosed: false,
    productBound: true,
    target: "record",
  },
  action: {
    label: "Record action",
    defaultTimeoutMs: 10_000,
    maxTimeoutMs: 30_000,
    defaultFailure: "block",
    failClosed: false,
    productBound: true,
    target: "record",
  },
  automation: {
    label: "Automation",
    defaultTimeoutMs: 30_000,
    maxTimeoutMs: 120_000,
    defaultFailure: "block",
    failClosed: false,
    productBound: false,
    target: "none",
  },
};

export const isExtensionPoint = (value: unknown): value is ExtensionPoint =>
  typeof value === "string" && (EXTENSION_POINTS as readonly string[]).includes(value);
