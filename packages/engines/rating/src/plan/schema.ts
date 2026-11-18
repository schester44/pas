import type { RoundingMode } from "@pas/kernel";
import { z } from "zod";

export type Operand = { step: string } | { path: string } | { value: string | number | boolean };

export interface Band {
  from?: number;
  to?: number;
}

export type DimensionMatch = "exact" | "band" | "interpolate";

export interface RateDimension {
  name: string;
  match: DimensionMatch;
}

export type RowKey = string | number | boolean | Band;

export interface RateRow {
  keys: RowKey[];
  value: string | number;
}

/** Band keys are half-open: `from` inclusive, `to` exclusive; either end may be open. */
export interface RateTable {
  key: string;
  dimensions: RateDimension[];
  rows: RateRow[];
  default?: string | number;
}

interface StepBase {
  name: string;
  label?: string;
}

export type Step = StepBase &
  (
    | { op: "lookup"; table: string; keys: Operand[] }
    | { op: "expression"; expression: string }
    | { op: "multiply" | "add" | "min" | "max"; operands: Operand[] }
    | { op: "subtract"; left: Operand; right: Operand }
    | { op: "cap"; value: Operand; max: Operand }
    | { op: "floor"; value: Operand; min: Operand }
    | { op: "round"; value: Operand; mode: RoundingMode; places: number }
    | { op: "sumCoverages"; coverages: string[]; scope: "exposure" | "policy" }
    | { op: "if"; condition: string; whenTrue: Operand; whenFalse: Operand }
  );

export type StepOp = Step["op"];

export interface CoverageAlgorithm {
  coverage: string;
  exposure?: string;
  steps: Step[];
  premium: string;
  minimumPremium?: string;
}

export interface RatingPlan {
  key: string;
  version: string;
  currency: string;
  rounding: { mode: RoundingMode; places: number };
  tables: RateTable[];
  algorithms: CoverageAlgorithm[];
  minimumPremium?: string;
}

const decimal = z.string().regex(/^-?\d+(\.\d+)?$/, "Enter a decimal amount");
const name = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Use letters, digits and underscores");
const rounding = z.enum(["half_up", "half_even", "up", "down"]);

const operand: z.ZodType<Operand> = z.union([
  z.object({ step: z.string().min(1) }).strict(),
  z.object({ path: z.string().min(1) }).strict(),
  z.object({ value: z.union([z.string(), z.number(), z.boolean()]) }).strict(),
]);

const band = z.object({ from: z.number().optional(), to: z.number().optional() }).strict();

export const rateTableSchema: z.ZodType<RateTable> = z.object({
  key: name,
  dimensions: z
    .array(z.object({ name: z.string().min(1), match: z.enum(["exact", "band", "interpolate"]) }))
    .min(1),
  rows: z.array(
    z.object({
      keys: z.array(z.union([z.string(), z.number(), z.boolean(), band])),
      value: z.union([decimal, z.number()]),
    }),
  ),
  default: z.union([decimal, z.number()]).optional(),
});

const base = { name, label: z.string().optional() };

const stepSchema: z.ZodType<Step> = z.discriminatedUnion("op", [
  z.object({ ...base, op: z.literal("lookup"), table: z.string(), keys: z.array(operand) }),
  z.object({ ...base, op: z.literal("expression"), expression: z.string().min(1) }),
  z.object({
    ...base,
    op: z.enum(["multiply", "add", "min", "max"]),
    operands: z.array(operand).min(1),
  }),
  z.object({ ...base, op: z.literal("subtract"), left: operand, right: operand }),
  z.object({ ...base, op: z.literal("cap"), value: operand, max: operand }),
  z.object({ ...base, op: z.literal("floor"), value: operand, min: operand }),
  z.object({
    ...base,
    op: z.literal("round"),
    value: operand,
    mode: rounding,
    places: z.number().int().min(0).max(10),
  }),
  z.object({
    ...base,
    op: z.literal("sumCoverages"),
    coverages: z.array(z.string()).min(1),
    scope: z.enum(["exposure", "policy"]),
  }),
  z.object({
    ...base,
    op: z.literal("if"),
    condition: z.string().min(1),
    whenTrue: operand,
    whenFalse: operand,
  }),
]);

export const ratingPlanSchema: z.ZodType<RatingPlan> = z.object({
  key: z.string().min(1),
  version: z.string().min(1),
  currency: z.string().length(3),
  rounding: z.object({ mode: rounding, places: z.number().int().min(0).max(10) }),
  tables: z.array(rateTableSchema),
  algorithms: z.array(
    z.object({
      coverage: z.string().min(1),
      exposure: z.string().optional(),
      steps: z.array(stepSchema).min(1),
      premium: z.string(),
      minimumPremium: decimal.optional(),
    }),
  ),
  minimumPremium: decimal.optional(),
});
