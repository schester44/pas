import { invalid } from "@pas/kernel";
import { type ExtensionPoint, type FailurePolicy, POINT_SPECS } from "./points";

export const RECORD_KINDS = ["submission", "policy"] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

export const ACTION_FIELD_KINDS = ["text", "number", "date", "boolean", "enum"] as const;

export interface ActionField {
  key: string;
  label: string;
  kind: (typeof ACTION_FIELD_KINDS)[number];
  required?: boolean;
  options?: { value: string; label: string }[];
}

/**
 * One extension attached to a product version at a point. Published extension versions are
 * immutable, so the id pins exactly what runs; the release manifest copies the bindings.
 */
export interface ExtensionBinding {
  id: string;
  point: ExtensionPoint;
  extensionVersionId: string;
  timeoutMs?: number;
  onFailure?: FailurePolicy;
  /** field_options / field_prefill: the schema path the binding serves or reacts to. */
  field?: string;
  /** record_panel / action: which record page shows it. */
  record?: RecordKind;
  /** record_panel title or action button label. */
  label?: string;
  /** action: what the user fills in before it runs. */
  inputFields?: ActionField[];
}

/** Points whose output replaces something, so two bindings would conflict. */
const SINGULAR = new Set<ExtensionPoint>(["installments", "cancellation_charges"]);

export function failurePolicyOf(
  binding: Pick<ExtensionBinding, "point" | "onFailure">,
): FailurePolicy {
  const spec = POINT_SPECS[binding.point];

  return spec.failClosed ? "block" : (binding.onFailure ?? spec.defaultFailure);
}

export function timeoutOf(binding: Pick<ExtensionBinding, "point" | "timeoutMs">): number {
  const spec = POINT_SPECS[binding.point];

  return Math.min(binding.timeoutMs ?? spec.defaultTimeoutMs, spec.maxTimeoutMs);
}

export const bindingsAt = <P extends ExtensionPoint>(
  bindings: readonly ExtensionBinding[] | undefined,
  point: P,
): (ExtensionBinding & { point: P })[] =>
  (bindings ?? []).filter(
    (binding): binding is ExtensionBinding & { point: P } => binding.point === point,
  );

/** Static checks on a version's bindings; whether each extension version exists is checked by its owner. */
export function checkBindings(
  bindings: readonly ExtensionBinding[],
  fieldPaths: ReadonlySet<string>,
): { bindingId: string; message: string }[] {
  const issues: { bindingId: string; message: string }[] = [];
  const seen = new Set<string>();

  for (const binding of bindings) {
    const spec = POINT_SPECS[binding.point];
    const issue = (message: string) => issues.push({ bindingId: binding.id, message });

    if (!spec.productBound)
      issue(`${spec.label} extensions are set up per tenant, not per product`);

    if (binding.point === "rate") issue("Choose an extension rater on the Rating tab instead");

    if (binding.point === "enrichment_transform")
      issue("Add it as a transform on the Data tab instead");

    if (SINGULAR.has(binding.point)) {
      if (seen.has(binding.point))
        issue(`Only one ${spec.label.toLowerCase()} extension can be bound`);

      seen.add(binding.point);
    }

    if (binding.timeoutMs !== undefined && binding.timeoutMs > spec.maxTimeoutMs) {
      issue(`${spec.label} extensions can run for at most ${spec.maxTimeoutMs / 1000}s`);
    }

    if (spec.target === "field") {
      if (!binding.field) issue("Choose the field this extension serves");
      else if (!fieldPaths.has(binding.field))
        issue(`The risk schema has no field ${binding.field}`);

      const key = `${binding.point}:${binding.field ?? ""}`;

      if (binding.point === "field_options" && seen.has(key)) {
        issue(`Only one extension can supply options for ${binding.field}`);
      }

      seen.add(key);
    }

    if (spec.target === "record") {
      if (!binding.record) issue("Choose the record page this extension appears on");

      if (!binding.label?.trim()) issue("Give it a label");
    }

    const keys = new Set<string>();

    for (const field of binding.inputFields ?? []) {
      if (!/^[a-z][a-zA-Z0-9_]*$/.test(field.key))
        issue(`Input field key ${field.key} isn't valid`);

      if (keys.has(field.key)) issue(`Input field ${field.key} appears twice`);

      if (field.kind === "enum" && !field.options?.length) issue(`${field.label} needs options`);

      keys.add(field.key);
    }
  }

  return issues;
}

/** What a record page shows from its product's extensions; the code stays server-side. */
export interface ExtensionSurface {
  bindingId: string;
  point: "record_panel" | "action";
  label: string;
  inputFields: ActionField[];
}

export function surfacesFor(
  bindings: readonly ExtensionBinding[] | undefined,
  record: RecordKind,
): ExtensionSurface[] {
  return (bindings ?? []).flatMap((b): ExtensionSurface[] =>
    (b.point === "record_panel" || b.point === "action") && b.record === record
      ? [
          {
            bindingId: b.id,
            point: b.point,
            label: b.label ?? "",
            inputFields: b.inputFields ?? [],
          },
        ]
      : [],
  );
}

/** Which form fields get options from an extension and which ones trigger a prefill. */
export function extensionFieldsOf(bindings: readonly ExtensionBinding[] | undefined) {
  const at = (point: ExtensionPoint) => [
    ...new Set(bindingsAt(bindings, point).flatMap((b) => (b.field ? [b.field] : []))),
  ];

  return { options: at("field_options"), prefill: at("field_prefill") };
}

export type ExtensionFields = ReturnType<typeof extensionFieldsOf>;

/** What a user typed into an action's inputs, checked against its fields; unknown keys dropped. */
export function checkActionInput(fields: readonly ActionField[], values: Record<string, unknown>) {
  for (const field of fields) {
    const value = values[field.key];
    const empty = value === undefined || value === null || value === "";

    if (empty) {
      if (field.required) throw invalid(`${field.label} is required`, { field: field.key });

      continue;
    }

    const ok =
      field.kind === "number"
        ? typeof value === "number" && Number.isFinite(value)
        : field.kind === "boolean"
          ? typeof value === "boolean"
          : field.kind === "enum"
            ? (field.options ?? []).some((o) => o.value === value)
            : field.kind === "date"
              ? typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
              : typeof value === "string" && value.length <= 2_000;

    if (!ok) throw invalid(`${field.label} isn't valid`, { field: field.key });
  }

  const known = new Set(fields.map((f) => f.key));

  return Object.fromEntries(Object.entries(values).filter(([key]) => known.has(key)));
}
