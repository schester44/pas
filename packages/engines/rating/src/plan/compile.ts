import { evaluate } from "@pas/expressions";
import { Money } from "@pas/kernel";
import { Decimal } from "decimal.js";
import {
  RatingError,
  type CoveragePremium,
  type CoverageSelection,
  type Rater,
  type RaterArtifact,
  type RatingInput,
  type RatingResult,
  type RatingWarning,
  type TraceValue,
  type WorksheetStep,
} from "../contract";
import { fromFloat, ratingContext, readPath, toDecimal, type RatingContext } from "../context";
import { topologicalOrder } from "../graph";
import { coverageDependencies, rootOf, stepReferences, structuralIssues } from "./check";
import {
  ratingPlanSchema,
  type CoverageAlgorithm,
  type Operand,
  type RatingPlan,
  type Step,
} from "./schema";
import { compileTable, type TableLookup } from "./tables";

type StepValue = Decimal | string | boolean | null;

interface Env {
  context: RatingContext;
  values: Map<string, StepValue>;
  selection: CoverageSelection;
  rated: CoveragePremium[];
  warnings: RatingWarning[];
}

interface Outcome {
  value: StepValue;
  inputs: WorksheetStep["inputs"];
}

type Executor = (env: Env) => Outcome;

const trace = (value: unknown): TraceValue => {
  if (value instanceof Decimal) return value.toFixed();

  if (value === undefined) return null;

  if (typeof value === "object" && value !== null) return JSON.stringify(value);

  return value as TraceValue;
};

interface CompiledOperand {
  ref: string;
  read: (env: Env) => unknown;
}

function compileOperand(operand: Operand): CompiledOperand {
  if ("step" in operand) return { ref: operand.step, read: (env) => env.values.get(operand.step) };

  if ("path" in operand)
    return { ref: operand.path, read: (env) => readPath(env.context, operand.path) };

  return { ref: "constant", read: () => operand.value };
}

function numbers(operands: Operand[]) {
  const compiled = operands.map(compileOperand);

  return (env: Env) => {
    const inputs: Outcome["inputs"] = [];

    const values = compiled.map((operand) => {
      const value = toDecimal(operand.read(env), operand.ref);
      inputs.push({ ref: operand.ref, value: trace(value) });

      return value;
    });

    return { values, inputs };
  };
}

function reduce(operands: Operand[], combine: (values: Decimal[]) => Decimal): Executor {
  const read = numbers(operands);

  return (env) => {
    const { values, inputs } = read(env);

    return { value: combine(values), inputs };
  };
}

const fromZen = (value: unknown): StepValue => {
  if (typeof value === "number") return fromFloat(value);

  if (typeof value === "string" || typeof value === "boolean" || value === null) return value;

  throw new RatingError("Expression returned a list or object, not a value");
};

const toZen = (value: StepValue | undefined) =>
  value instanceof Decimal ? value.toNumber() : value;

function compileExpression(expression: string, stepNames: ReadonlySet<string>) {
  const refs = stepReferences({ name: "_", op: "expression", expression }, stepNames);
  const roots = [...new Set(refs.paths.map(rootOf))];

  return (env: Env) => {
    const scope: Record<string, unknown> = {};

    for (const root of roots) scope[root] = env.context[root as keyof RatingContext];

    for (const step of refs.steps) scope[step] = toZen(env.values.get(step));

    const inputs = [
      ...refs.steps.map((ref) => ({ ref, value: trace(env.values.get(ref)) })),
      ...refs.paths.map((ref) => ({ ref, value: trace(readPath(env.context, ref)) })),
    ];

    return { value: fromZen(evaluate(expression, scope)), inputs };
  };
}

function compileStep(
  step: Step,
  tables: Map<string, TableLookup>,
  stepNames: ReadonlySet<string>,
): Executor {
  switch (step.op) {
    case "lookup": {
      const lookup = tables.get(step.table)!;
      const keys = step.keys.map(compileOperand);

      return (env) => {
        const values = keys.map((key) => key.read(env));
        const match = lookup(values);
        const inputs = keys.map((key, i) => ({ ref: key.ref, value: trace(values[i]) }));

        if (!match) {
          throw new RatingError(`No row in ${step.table} for ${values.map(String).join(", ")}`, {
            step: step.name,
            table: step.table,
          });
        }

        if (match.matched === "default") {
          env.warnings.push({
            code: "table_default",
            message: `${step.table} used its default row for ${values.map(String).join(", ")}`,
            coverage: env.selection.coverage,
            exposure: env.selection.exposure,
          });
        }

        return { value: match.value, inputs: [...inputs, { ref: "row", value: match.matched }] };
      };
    }

    case "expression":
      return compileExpression(step.expression, stepNames);

    case "multiply":
      return reduce(step.operands, (v) => v.reduce((a, b) => a.times(b)));

    case "add":
      return reduce(step.operands, (v) => v.reduce((a, b) => a.plus(b)));

    case "min":
      return reduce(step.operands, (v) => Decimal.min(...v));

    case "max":
      return reduce(step.operands, (v) => Decimal.max(...v));

    case "subtract":
      return reduce([step.left, step.right], ([a, b]) => a!.minus(b!));

    case "cap":
      return reduce([step.value, step.max], ([value, max]) => Decimal.min(value!, max!));

    case "floor":
      return reduce([step.value, step.min], ([value, min]) => Decimal.max(value!, min!));

    case "round":
      return reduce(
        [step.value],
        ([value]) => Money.of(value!).round(step.places, step.mode).amount,
      );

    case "sumCoverages": {
      const codes = new Set(step.coverages);

      return (env) => {
        const parts = env.rated.filter(
          (rated) =>
            codes.has(rated.coverage) &&
            (step.scope === "policy" || rated.exposure === env.selection.exposure),
        );

        return {
          value: parts.reduce((sum, part) => sum.plus(part.premium.amount), new Decimal(0)),
          inputs: parts.map((part) => ({
            ref: part.exposure ? `${part.coverage}@${part.exposure}` : part.coverage,
            value: part.premium.toString(),
          })),
        };
      };
    }

    case "if": {
      const condition = compileExpression(step.condition, stepNames);
      const whenTrue = compileOperand(step.whenTrue);
      const whenFalse = compileOperand(step.whenFalse);

      return (env) => {
        const test = condition(env);
        const branch = test.value === true ? whenTrue : whenFalse;
        const value = branch.read(env);
        const normalized = typeof value === "number" ? fromFloat(value) : (value as StepValue);

        return {
          value: normalized ?? null,
          inputs: [
            ...test.inputs,
            { ref: "condition", value: test.value === true },
            { ref: branch.ref, value: trace(value) },
          ],
        };
      };
    }
  }
}

function describeStep(step: Step): string {
  switch (step.op) {
    case "lookup":
      return `lookup(${step.table})`;
    case "expression":
      return step.expression;
    case "round":
      return `round(${step.mode}, ${step.places})`;
    case "sumCoverages":
      return `sumCoverages(${step.coverages.join(", ")}; ${step.scope})`;
    case "if":
      return `if(${step.condition})`;
    default:
      return step.op;
  }
}

interface CompiledAlgorithm {
  coverage: string;
  steps: { step: Step; run: Executor; operation: string }[];
  premium: string;
  minimum?: Decimal;
}

function compileAlgorithm(
  algorithm: CoverageAlgorithm,
  tables: Map<string, TableLookup>,
): CompiledAlgorithm {
  const names = new Set(algorithm.steps.map((step) => step.name));
  const byName = new Map(algorithm.steps.map((step) => [step.name, step]));

  const { order } = topologicalOrder(
    algorithm.steps.map((step) => step.name),
    (name) => stepReferences(byName.get(name)!, names).steps,
  );

  return {
    coverage: algorithm.coverage,
    premium: algorithm.premium,
    minimum:
      algorithm.minimumPremium === undefined ? undefined : new Decimal(algorithm.minimumPremium),
    steps: order.map((name) => {
      const step = byName.get(name)!;

      return { step, run: compileStep(step, tables, names), operation: describeStep(step) };
    }),
  };
}

export interface CompiledRatingPlan {
  readonly artifact: RaterArtifact;
  rate(input: RatingInput): RatingResult;
}

export function compileRatingPlan(source: RatingPlan): CompiledRatingPlan {
  const plan = ratingPlanSchema.parse(source);
  const issues = structuralIssues(plan);

  if (issues.length) {
    throw new RatingError(`Rating plan ${plan.key} has ${issues.length} issue(s)`, { issues });
  }

  const tables = new Map(plan.tables.map((table) => [table.key, compileTable(table)]));
  const byCoverage = new Map(plan.algorithms.map((a) => [a.coverage, a]));

  const order = topologicalOrder([...byCoverage.keys()], (code) =>
    coverageDependencies(byCoverage.get(code)!),
  ).order.map((code) => compileAlgorithm(byCoverage.get(code)!, tables));

  const policyMinimum =
    plan.minimumPremium === undefined ? undefined : new Decimal(plan.minimumPremium);

  const artifact: RaterArtifact = { kind: "rating_plan", key: plan.key, version: plan.version };

  const rateSelection = (
    algorithm: CompiledAlgorithm,
    input: RatingInput,
    selection: CoverageSelection,
    result: RatingResult,
  ) => {
    const env: Env = {
      context: ratingContext(input, selection.exposure, selection),
      values: new Map(),
      selection,
      rated: result.coverages,
      warnings: result.warnings,
    };

    for (const { step, run, operation } of algorithm.steps) {
      let outcome: Outcome;

      try {
        outcome = run(env);
      } catch (error) {
        throw new RatingError(`${algorithm.coverage}/${step.name}: ${(error as Error).message}`, {
          coverage: algorithm.coverage,
          exposure: selection.exposure,
          step: step.name,
        });
      }

      env.values.set(step.name, outcome.value);

      result.worksheet.push({
        coverage: algorithm.coverage,
        exposure: selection.exposure,
        name: step.label ?? step.name,
        operation,
        inputs: outcome.inputs,
        output: trace(outcome.value),
      });
    }

    const calculated = Money.of(
      toDecimal(env.values.get(algorithm.premium), `${algorithm.coverage} premium`),
      input.currency,
    ).round(plan.rounding.places, plan.rounding.mode);

    let premium = calculated;

    if (algorithm.minimum && calculated.amount.lt(algorithm.minimum)) {
      premium = Money.of(algorithm.minimum, input.currency);

      result.adjustments.push({
        scope: "coverage",
        coverage: algorithm.coverage,
        exposure: selection.exposure,
        minimum: premium,
        adjustment: premium.minus(calculated),
      });
    }

    result.coverages.push({
      coverage: algorithm.coverage,
      exposure: selection.exposure,
      premium,
      calculated,
    });
  };

  return {
    artifact,
    rate(input) {
      if (input.currency !== plan.currency) {
        throw new RatingError(`Plan ${plan.key} rates in ${plan.currency}, not ${input.currency}`);
      }

      const unknown = input.coverages.filter((selection) => !byCoverage.has(selection.coverage));

      if (unknown.length) {
        throw new RatingError(`No algorithm for ${unknown.map((s) => s.coverage).join(", ")}`);
      }

      const result: RatingResult = {
        currency: input.currency,
        coverages: [],
        adjustments: [],
        factors: [],
        total: Money.zero(input.currency),
        warnings: [],
        worksheet: [],
        artifact,
      };

      for (const algorithm of order) {
        for (const selection of input.coverages) {
          if (selection.coverage === algorithm.coverage)
            rateSelection(algorithm, input, selection, result);
        }
      }

      let total = result.coverages.reduce(
        (sum, c) => sum.plus(c.premium),
        Money.zero(input.currency),
      );

      if (policyMinimum && total.amount.lt(policyMinimum)) {
        const minimum = Money.of(policyMinimum, input.currency);
        result.adjustments.push({ scope: "policy", minimum, adjustment: minimum.minus(total) });
        total = minimum;
      }

      result.total = total;

      return result;
    },
  };
}

const cache = new Map<string, CompiledRatingPlan>();
const CACHE_LIMIT = 256;

/** `cacheKey` must identify an immutable plan version (e.g. its release id or content hash). */
export function createPlanRater(plan: RatingPlan, options: { cacheKey?: string } = {}): Rater {
  const key = options.cacheKey;
  let compiled = key === undefined ? undefined : cache.get(key);

  if (!compiled) {
    compiled = compileRatingPlan(plan);

    if (key !== undefined) {
      if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);

      cache.set(key, compiled);
    }
  }

  const ready = compiled;

  return {
    artifact: ready.artifact,
    rate: async (input: RatingInput) => ready.rate(input),
  };
}
