import { sampleRisk } from "@pas/documents";
import { getAt, indexSchema, isField, type RiskSchema } from "@pas/forms-core";
import type {
  BindingManifest,
  CoverageAlgorithm,
  CoverageSelection,
  Operand,
  RatingInput,
  RatingPlan,
  Step,
  StepOp,
} from "@pas/rating-engine/plan";
import type { Contents, Coverage, RatingConfig } from "@/components/catalog/version-editor";
import { humanize } from "@/components/decisions/jdm-edit";

export const STEP_OPS: Record<StepOp, { label: string; description: string }> = {
  lookup: { label: "Look up", description: "Read a rate or factor from a table." },
  multiply: { label: "Multiply", description: "Multiply values together." },
  add: { label: "Add", description: "Add values together." },
  subtract: { label: "Subtract", description: "Take one value from another." },
  min: { label: "Lowest of", description: "The smallest of the values." },
  max: { label: "Highest of", description: "The largest of the values." },
  cap: { label: "Cap", description: "Limit a value to a maximum." },
  floor: { label: "At least", description: "Raise a value to a minimum." },
  round: { label: "Round", description: "Round to a number of decimal places." },
  expression: { label: "Expression", description: "Calculate with a formula." },
  if: { label: "If", description: "Choose between two values." },
  sumCoverages: { label: "Sum coverages", description: "Add up premiums already rated." },
};

export const STEP_OP_ORDER = Object.keys(STEP_OPS) as StepOp[];

export function today(): string {
  return Temporal.Now.plainDateISO().toString();
}

export function newPlan(version: string, currency: string): RatingPlan {
  return {
    key: "rates",
    version,
    currency,
    rounding: { mode: "half_up", places: 2 },
    tables: [],
    algorithms: [],
  };
}

export function newManifest(version: string, currency: string): BindingManifest {
  return {
    key: "workbook",
    version,
    currency,
    rounding: { mode: "half_up", places: 2 },
    inputs: [],
    outputs: [],
  };
}

export const exposureOf = (coverage: Coverage | undefined) =>
  coverage?.attachesTo.level === "exposure" ? `${coverage.attachesTo.path}[]` : undefined;

export function newAlgorithm(coverage: Coverage): CoverageAlgorithm {
  const exposure = exposureOf(coverage);

  return {
    coverage: coverage.code,
    ...(exposure && { exposure }),
    steps: [{ name: "premium", label: "Premium", op: "multiply", operands: [] }],
    premium: "premium",
  };
}

export function newStep(op: StepOp, name: string): Step {
  const base = { name, label: STEP_OPS[op].label };

  switch (op) {
    case "lookup":
      return { ...base, op, table: "", keys: [] };
    case "expression":
      return { ...base, op, expression: "" };
    case "multiply":
    case "add":
    case "min":
    case "max":
      return { ...base, op, operands: [] };
    case "subtract":
      return { ...base, op, left: { value: 0 }, right: { value: 0 } };
    case "cap":
      return { ...base, op, value: { value: 0 }, max: { value: 0 } };
    case "floor":
      return { ...base, op, value: { value: 0 }, min: { value: 0 } };
    case "round":
      return { ...base, op, value: { value: 0 }, mode: "half_up", places: 0 };
    case "sumCoverages":
      return { ...base, op, coverages: [], scope: "policy" };
    case "if":
      return { ...base, op, condition: "", whenTrue: { value: 1 }, whenFalse: { value: 1 } };
  }
}

export function uniqueName(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const clean = base.replace(/[^A-Za-z0-9_]/g, "_").replace(/^[^A-Za-z_]/, "_") || "step";

  if (!used.has(clean)) return clean;

  for (let i = 2; ; i++) if (!used.has(`${clean}_${i}`)) return `${clean}_${i}`;
}

export interface OperandOption {
  operand: Operand;
  label: string;
  detail: string;
  group: string;
}

export const operandKey = (operand: Operand) =>
  "step" in operand
    ? `step:${operand.step}`
    : "path" in operand
      ? `path:${operand.path}`
      : `value:${String(operand.value)}`;

/** Every value a step can read: earlier steps, risk and exposure fields, coverage terms. */
export function operandOptions(
  schema: RiskSchema,
  coverages: readonly Coverage[],
  algorithm: CoverageAlgorithm | undefined,
  before: readonly Step[],
): OperandOption[] {
  const options: OperandOption[] = before.map((step) => ({
    operand: { step: step.name },
    label: step.label || humanize(step.name),
    detail: step.name,
    group: "Earlier steps",
  }));

  const exposure = algorithm?.exposure?.replace(/\[\]$/, "");

  for (const node of indexSchema(schema).values()) {
    if (!isField(node)) continue;

    if (exposure && node.path.startsWith(`${exposure}[].`)) {
      const path = `exposure.${node.path.slice(exposure.length + 3)}`;
      options.push({ operand: { path }, label: node.label, detail: path, group: "Exposure" });
    } else if (!node.path.includes("[]")) {
      const path = `risk.${node.path}`;
      options.push({ operand: { path }, label: node.label, detail: path, group: "Risk" });
    }
  }

  if (algorithm) {
    for (const term of ["limit", "deductible"]) {
      const path = `coverage.${term}`;
      options.push({ operand: { path }, label: humanize(term), detail: path, group: "Coverage" });
    }
  }

  for (const coverage of coverages) {
    if (coverage.code === algorithm?.coverage || !coverage.limitOptions) continue;

    const path = `coverages.${coverage.code}.limit`;

    options.push({
      operand: { path },
      label: `${coverage.name} limit`,
      detail: path,
      group: "Other coverages",
    });
  }

  options.push(
    { operand: { path: "term.days" }, label: "Term days", detail: "term.days", group: "Term" },
    {
      operand: { path: "jurisdiction.subdivision" },
      label: "State",
      detail: "jurisdiction.subdivision",
      group: "Term",
    },
  );

  return options;
}

export function describeOperand(
  operand: Operand,
  options: readonly OperandOption[],
): { label: string; detail?: string } {
  if ("value" in operand) return { label: String(operand.value) };

  const found = options.find((option) => operandKey(option.operand) === operandKey(operand));

  if (found) return { label: found.label, detail: found.detail };

  return { label: "step" in operand ? operand.step : operand.path };
}

const amountOf = (set: Coverage["limitOptions"]) => {
  const option = set?.options[set.defaultIndex];

  if (!option) return undefined;

  return option.kind === "money" ? option.amount : option.value;
};

export function coverageSelections(
  coverages: readonly Coverage[],
  risk: Record<string, unknown>,
): CoverageSelection[] {
  return coverages.flatMap((coverage) => {
    const limit = amountOf(coverage.limitOptions);
    const deductible = amountOf(coverage.deductibleOptions);

    const base: CoverageSelection = {
      coverage: coverage.code,
      ...(limit && { limit }),
      ...(deductible && { deductible }),
    };

    if (coverage.attachesTo.level === "policy") return [base];

    const path = coverage.attachesTo.path;
    const entries = getAt(risk, path);
    const count = Array.isArray(entries) ? entries.length : 1;

    return Array.from({ length: count }, (_, i) => ({
      ...base,
      exposure: Array.isArray(entries) ? `${path}[${i}]` : path,
    }));
  });
}

export function ratedCoverages(rating: RatingConfig | null): Set<string> {
  if (!rating) return new Set();

  if (rating.engine === "plan") return new Set(rating.plan.algorithms.map((a) => a.coverage));

  return new Set(
    rating.manifest.outputs.flatMap((o) => (o.kind === "premium" ? [o.coverage] : [])),
  );
}

export function currencyOf(rating: RatingConfig | null): string {
  if (!rating) return "USD";

  return rating.engine === "plan" ? rating.plan.currency : rating.manifest.currency;
}

export function sampleInput(contents: Contents, risk?: Record<string, unknown>): RatingInput {
  const window = contents.availability[0];
  const jurisdiction = window?.jurisdiction ?? { country: "US" };
  const effective = window?.newBusiness.from ?? today();
  const data = risk ?? sampleRisk(contents.riskSchema, jurisdiction, effective);

  const rated = ratedCoverages(contents.rating);
  const offered = contents.coverages.filter((c) => c.required || rated.has(c.code));

  return {
    risk: data,
    coverages: coverageSelections(offered, data),
    term: {
      effective,
      expiration: Temporal.PlainDate.from(effective).add({ years: 1 }).toString(),
    },
    transaction: { type: "NEW_BUSINESS", effective },
    jurisdiction,
    currency: currencyOf(contents.rating),
  };
}

export const coverageLabel = (coverages: readonly Coverage[], code: string) =>
  coverages.find((c) => c.code === code)?.name ?? code;

export function exposureLabel(schema: RiskSchema, exposure: string | undefined): string {
  if (!exposure) return "Policy";

  const match = /^(.*)\[(\d+)\]$/.exec(exposure);

  if (!match) return exposure;

  const node = indexSchema(schema).get(match[1]!);
  const noun = node && "exposure" in node && node.exposure ? humanize(node.exposure) : "Entry";

  return `${noun} ${Number(match[2]) + 1}`;
}
