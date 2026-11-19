import { z } from "zod";
import { DecisionError } from "./errors";

type Row = z.ZodObject;

interface KindDefinition<R extends Row | undefined, Result> {
  label: string;
  cardinality: "many" | "one";
  row: R;
  /** Lifecycle inputs the caller adds to the risk data for this kind (e.g. `notice.reason`). */
  contextPaths?: readonly string[];
  aggregate: (rows: R extends Row ? z.output<R>[] : unknown, raw: unknown) => Result;
}

const defineKind = <R extends Row | undefined, Result>(definition: KindDefinition<R, Result>) =>
  definition;

const text = z.string().trim().min(1);
const codes = z.array(text);

function toDecimal(value: number | string): string {
  if (typeof value === "string") return value;

  const plain = String(value);

  return /e/i.test(plain) ? value.toFixed(20).replace(/\.?0+$/, "") : plain;
}

const decimal = z
  .union([z.number().finite(), z.string().regex(/^-?\d+(\.\d+)?$/, "Use a decimal number")])
  .transform(toDecimal);

function contractMessage(issue: z.core.$ZodIssue): string {
  if (issue.code === "invalid_value") {
    return `use one of ${issue.values.map((value) => String(value)).join(", ")}`;
  }

  if (issue.code === "invalid_type" && issue.message.endsWith("received undefined"))
    return "is required";

  if (issue.code === "too_small" && issue.origin === "string") return "is required";

  return issue.message;
}

export const UNDERWRITING_OUTCOMES = ["pass", "info_needed", "refer", "decline"] as const;

export type UnderwritingOutcome = (typeof UNDERWRITING_OUTCOMES)[number];

const outcomeRow = <O extends readonly [string, ...string[]]>(outcomes: O) =>
  z.object({
    rule: text.optional(),
    outcome: z.enum(outcomes),
    reasonCode: text,
    message: text,
    internalMessage: text.optional(),
    authority: text.optional(),
  });

const PRECEDENCE: readonly UnderwritingOutcome[] = ["decline", "refer", "info_needed"];

export function overallOutcome<O extends UnderwritingOutcome>(
  outcomes: readonly { outcome: O }[],
): O | "pass" {
  for (const candidate of PRECEDENCE) {
    if (outcomes.some((o) => o.outcome === candidate)) return candidate as O;
  }

  return "pass";
}

/** What an obligation is for (PLAN §17.1); the engine is the same for all of them. */
export const OBLIGATION_KINDS = [
  "sl_filing",
  "sl_affidavit",
  "sl_remittance",
  "notice",
  "bordereau",
  "stat_report",
  "adverse_action",
  "evidence_of_insurance",
  "ams_download",
  "carrier_report",
  "custom",
] as const;

export type ObligationKind = (typeof OBLIGATION_KINDS)[number];

/** How an obligation is delivered; the filing channel adapter is chosen per kind and jurisdiction. */
export const CHANNEL_KINDS = ["api", "file_export", "manual", "print_mail", "email"] as const;

export type ChannelKind = (typeof CHANNEL_KINDS)[number];

export const DUE_FROM = ["effective", "issue", "later_of_effective_issue"] as const;

export type DueFrom = (typeof DUE_FROM)[number];

export const REPORT_FREQUENCIES = ["monthly", "quarterly", "semiannual", "annual"] as const;

export type ReportFrequency = (typeof REPORT_FREQUENCIES)[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

const obligationRule = {
  kind: z.enum(OBLIGATION_KINDS),
  code: text,
  title: text,
  dueDays: z.number().int().min(0),
  businessDays: z.boolean().optional(),
  channel: z.enum(CHANNEL_KINDS),
  responsible: z.enum(["licensee", "tenant", "agency", "carrier"]).optional(),
  remindDays: z.number().int().min(0).optional(),
  escalateDays: z.number().int().min(0).optional(),
  holidays: z.array(isoDate).optional(),
};

const firstPerCode = <T extends { code: string }>(rows: T[]) => {
  const seen = new Set<string>();

  return rows.filter((row) => !seen.has(row.code) && seen.add(row.code));
};

const withRuleNames = <T extends { rule?: string; reasonCode: string }>(rows: T[]) =>
  rows.map((row) => ({ ...row, rule: row.rule ?? row.reasonCode }));

export const DECISION_KINDS = {
  underwriting: defineKind({
    label: "Underwriting",
    cardinality: "many",
    row: outcomeRow(UNDERWRITING_OUTCOMES),
    aggregate: (rows) => {
      const outcomes = withRuleNames(rows);

      return { outcomes, overall: overallOutcome(outcomes) };
    },
  }),
  eligibility: defineKind({
    label: "Eligibility",
    cardinality: "many",
    row: outcomeRow(["pass", "decline"] as const),
    aggregate: (rows) => {
      const outcomes = withRuleNames(rows);

      return { outcomes, overall: overallOutcome(outcomes) };
    },
  }),
  coverage_options: defineKind({
    label: "Coverage options",
    cardinality: "many",
    row: z.object({
      coverage: text,
      options: z.array(z.union([z.string(), z.number()])).optional(),
      default: z.union([z.string(), z.number()]).optional(),
    }),
    aggregate: (rows) => {
      const coverages: Record<string, { options: (string | number)[]; default?: string | number }> =
        {};

      for (const row of rows) {
        const entry = (coverages[row.coverage] ??= { options: [] });

        for (const option of row.options ?? []) {
          if (!entry.options.includes(option)) entry.options.push(option);
        }

        if (row.default !== undefined && entry.default === undefined) entry.default = row.default;
      }

      return { coverages };
    },
  }),
  taxes_fees: defineKind({
    label: "Taxes and fees",
    cardinality: "many",
    row: z
      .object({
        code: text,
        label: text,
        rate: decimal.optional(),
        amount: decimal.optional(),
        currency: z
          .string()
          .regex(/^[A-Z]{3}$/, "Use an ISO 4217 currency code")
          .optional(),
        basis: z.enum(["premium", "premium_and_fees", "flat"]),
        taxable: z.boolean(),
        remitter: z.enum(["licensee", "carrier", "producer"]),
        rounding: z.enum(["half_up", "half_even", "up", "down"]).optional(),
        places: z.number().int().min(0).max(6).optional(),
      })
      .refine((line) => (line.rate === undefined) !== (line.amount === undefined), {
        message: "Give either a rate or an amount",
        path: ["rate"],
      })
      .refine((line) => line.amount === undefined || line.currency !== undefined, {
        message: "Amounts need a currency",
        path: ["currency"],
      }),
    aggregate: (rows) => ({ lines: rows }),
  }),
  form_schedule: defineKind({
    label: "Form schedule",
    cardinality: "many",
    row: z.object({ document: text }),
    aggregate: (rows) => ({ documents: [...new Set(rows.map((row) => row.document))] }),
  }),
  notice_rules: defineKind({
    label: "Notice rules",
    cardinality: "one",
    contextPaths: [
      "notice",
      "notice.type",
      "notice.reason",
      "notice.initiator",
      "notice.policyAgeDays",
    ],
    row: z.object({
      minDaysNotice: z.number().int().min(0),
      mailingDaysAdded: z.number().int().min(0),
      allowedReasons: codes,
      deliveryMethods: codes.min(1),
      recipients: codes.min(1),
      mustStateReason: z.boolean().optional(),
    }),
    aggregate: (rows) => rows[0] ?? null,
  }),
  cancellation_terms: defineKind({
    label: "Cancellation terms",
    cardinality: "one",
    contextPaths: ["cancellation", "cancellation.reason", "cancellation.initiator"],
    row: z
      .object({
        method: z.enum(["pro_rata"]).optional(),
        minimumEarnedType: z.enum(["percent", "flat"]).optional(),
        minimumEarnedValue: decimal.optional(),
        minimumEarnedLevel: z.enum(["policy", "coverage"]).optional(),
        minimumEarnedAppliesTo: codes.optional(),
        fullyEarnedFees: codes.optional(),
      })
      .refine(
        (row) => (row.minimumEarnedType === undefined) === (row.minimumEarnedValue === undefined),
        {
          message: "Give both the minimum earned type and value",
          path: ["minimumEarnedValue"],
        },
      ),
    aggregate: (rows) => rows[0] ?? null,
  }),
  dea: defineKind({
    label: "Diligent search",
    cardinality: "one",
    row: z
      .object({
        required: z.boolean(),
        declinationsRequired: z.number().int().min(0),
        timing: z.enum(["pre_bind", "post_bind"]).optional(),
        exemptions: codes,
        fileAffidavit: z.boolean().optional(),
      })
      .refine((dea) => !dea.required || dea.timing !== undefined, {
        message: "Say when the diligent search is due",
        path: ["timing"],
      }),
    aggregate: (rows) => rows[0] ?? null,
  }),
  attestations: defineKind({
    label: "Attestations",
    cardinality: "many",
    row: z.object({ code: text, title: text, statement: text }),
    aggregate: (rows) => {
      const seen = new Set<string>();

      return {
        attestations: rows.filter((row) => !seen.has(row.code) && seen.add(row.code)),
      };
    },
  }),
  referral_triggers: defineKind({
    label: "Referral triggers",
    cardinality: "many",
    row: z.object({ code: text, message: text, authority: text.optional() }),
    aggregate: (rows) => ({ triggers: rows }),
  }),
  filing_obligations: defineKind({
    label: "Filing obligations",
    cardinality: "many",
    contextPaths: [
      "transaction",
      "transaction.type",
      "transaction.premiumBearing",
      "transaction.premium",
      "homeState",
      "diligentSearch",
      "diligentSearch.required",
      "diligentSearch.fileAffidavit",
      "diligentSearch.timing",
    ],
    row: z.object({
      ...obligationRule,
      dueFrom: z.enum(DUE_FROM),
      jurisdiction: text.optional(),
    }),
    aggregate: (rows) => ({ obligations: firstPerCode(rows) }),
  }),
  reporting_obligations: defineKind({
    label: "Reporting obligations",
    cardinality: "many",
    contextPaths: ["homeState", "report", "report.kind"],
    row: z.object({
      ...obligationRule,
      frequency: z.enum(REPORT_FREQUENCIES),
      aggregates: z.enum(OBLIGATION_KINDS),
    }),
    aggregate: (rows) => ({ obligations: firstPerCode(rows) }),
  }),
  custom: defineKind({
    label: "Custom",
    cardinality: "many",
    row: undefined,
    aggregate: (_rows, raw) => raw,
  }),
};

export type DecisionKind = keyof typeof DECISION_KINDS;

export const DECISION_KIND_KEYS = Object.keys(DECISION_KINDS) as DecisionKind[];

export type DecisionResult<K extends DecisionKind> = ReturnType<
  (typeof DECISION_KINDS)[K]["aggregate"]
>;

export const kindContextPaths = (kind: DecisionKind): readonly string[] =>
  (DECISION_KINDS[kind] as { contextPaths?: readonly string[] }).contextPaths ?? [];

export interface ContractField {
  key: string;
  required: boolean;
  options?: readonly string[];
}

export function contractFields(kind: DecisionKind): ContractField[] {
  const row = DECISION_KINDS[kind].row;

  if (!row) return [];

  return Object.entries(row.shape).map(([key, schema]) => {
    const field = schema as z.ZodType;
    const inner = field instanceof z.ZodOptional ? field.unwrap() : field;

    return {
      key,
      required: !field.safeParse(undefined).success,
      ...(inner instanceof z.ZodEnum ? { options: inner.options as string[] } : {}),
    };
  });
}

export function checkContractValue(
  kind: DecisionKind,
  field: string,
  value: unknown,
): string | undefined {
  const shape: Record<string, z.ZodType> | undefined = DECISION_KINDS[kind].row?.shape;
  const schema = shape?.[field];

  if (!schema) return undefined;

  const parsed = schema.safeParse(value);

  if (parsed.success) return undefined;

  const options = contractFields(kind).find((f) => f.key === field)?.options;

  return options ? `Use one of ${options.join(", ")}` : parsed.error.issues[0]?.message;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const withoutNulls = (row: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(row).filter(([, value]) => value != null));

export function rowsOf(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw.map((row) => (isRecord(row) ? withoutNulls(row) : row));

  if (isRecord(raw)) return Object.keys(raw).length > 0 ? [withoutNulls(raw)] : [];

  return [];
}

export interface ContractIssue {
  row: number;
  path: string;
  message: string;
}

export function aggregate<K extends DecisionKind>(kind: K, raw: unknown): DecisionResult<K> {
  const definition = DECISION_KINDS[kind] as KindDefinition<Row | undefined, DecisionResult<K>>;

  if (!definition.row) return definition.aggregate(raw, raw);

  const rows = rowsOf(raw);
  const issues: ContractIssue[] = [];
  const parsed: unknown[] = [];

  if (definition.cardinality === "one" && rows.length > 1) {
    issues.push({ row: 1, path: "", message: `Expected one result, got ${rows.length}` });
  }

  for (const [index, row] of rows.entries()) {
    const result = definition.row.safeParse(row);

    if (result.success) parsed.push(result.data);
    else {
      for (const issue of result.error.issues) {
        issues.push({ row: index, path: issue.path.join("."), message: contractMessage(issue) });
      }
    }
  }

  if (issues.length > 0) {
    throw new DecisionError(
      "contract_violation",
      `The decision's output doesn't match the ${definition.label.toLowerCase()} contract`,
      { kind, issues },
    );
  }

  return definition.aggregate(parsed as never, raw);
}
