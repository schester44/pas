import { referencedPaths, validate } from "@pas/expressions";
import type { MessageParams } from "@pas/kernel";
import { CONTEXT_ROOTS } from "../context";
import { topologicalOrder } from "../graph";
import {
  ratingPlanSchema,
  type CoverageAlgorithm,
  type Operand,
  type RatingPlan,
  type Step,
} from "./schema";

export interface PlanIssue {
  coverage?: string;
  step?: string;
  table?: string;
  property: string;
  message: string;
  params?: MessageParams;
}

export type PathResolver = Iterable<string> | ((path: string) => boolean);

const ROOTS = new Set<string>(CONTEXT_ROOTS);

export const rootOf = (path: string) => /^[^.[]*/.exec(path)![0];

export function stepOperands(step: Step): Operand[] {
  switch (step.op) {
    case "lookup":
      return step.keys;
    case "multiply":
    case "add":
    case "min":
    case "max":
      return step.operands;
    case "subtract":
      return [step.left, step.right];
    case "cap":
      return [step.value, step.max];
    case "floor":
      return [step.value, step.min];
    case "round":
      return [step.value];
    case "if":
      return [step.whenTrue, step.whenFalse];
    default:
      return [];
  }
}

export function stepExpression(step: Step): string | undefined {
  if (step.op === "expression") return step.expression;

  if (step.op === "if") return step.condition;

  return undefined;
}

export function expressionPaths(expression: string): string[] | string {
  const check = validate(expression);

  if (!check.ok) return check.message;

  try {
    return referencedPaths(expression);
  } catch (error) {
    return (error as Error).message;
  }
}

export interface StepReferences {
  steps: string[];
  paths: string[];
  errors: { property: string; message: string }[];
}

export function stepReferences(step: Step, stepNames: ReadonlySet<string>): StepReferences {
  const refs: StepReferences = { steps: [], paths: [], errors: [] };

  for (const operand of stepOperands(step)) {
    if ("step" in operand) refs.steps.push(operand.step);
    else if ("path" in operand) refs.paths.push(operand.path);
  }

  const expression = stepExpression(step);

  if (expression !== undefined) {
    const paths = expressionPaths(expression);

    if (typeof paths === "string") refs.errors.push({ property: "expression", message: paths });
    else {
      for (const path of paths) {
        const root = rootOf(path);

        if (stepNames.has(root)) refs.steps.push(root);
        else refs.paths.push(path);
      }
    }
  }

  return refs;
}

function checkTables(plan: RatingPlan, report: (issue: PlanIssue) => void) {
  const seen = new Set<string>();

  for (const table of plan.tables) {
    if (seen.has(table.key))
      report({ table: table.key, property: "key", message: "Duplicate table" });

    seen.add(table.key);

    if (table.dimensions.filter((d) => d.match === "interpolate").length > 1) {
      report({
        table: table.key,
        property: "dimensions",
        message: "Interpolate on one dimension only",
      });
    }

    table.rows.forEach((row, index) => {
      const where = { table: table.key, property: `rows[${index}]` };

      if (row.keys.length !== table.dimensions.length) {
        report({
          ...where,
          message: `Has ${row.keys.length} keys for ${table.dimensions.length} dimensions`,
        });

        return;
      }

      table.dimensions.forEach((dimension, i) => {
        const key = row.keys[i];

        if (dimension.match === "band" && typeof key !== "object") {
          report({ ...where, message: `${dimension.name} needs a band ({ from, to })` });
        }

        if (dimension.match === "interpolate" && Number.isNaN(Number(key))) {
          report({ ...where, message: `${dimension.name} needs a number to interpolate` });
        }

        if (dimension.match === "exact" && typeof key === "object") {
          report({ ...where, message: `${dimension.name} matches exactly; use a plain value` });
        }
      });
    });
  }
}

function checkAlgorithm(
  plan: RatingPlan,
  algorithm: CoverageAlgorithm,
  report: (issue: PlanIssue) => void,
) {
  const coverage = algorithm.coverage;
  const names = new Set<string>();
  const tables = new Map(plan.tables.map((table) => [table.key, table]));
  const covered = new Set(plan.algorithms.map((a) => a.coverage));

  for (const step of algorithm.steps) {
    if (names.has(step.name))
      report({ coverage, step: step.name, property: "name", message: "Duplicate step" });

    if (ROOTS.has(step.name)) {
      report({
        coverage,
        step: step.name,
        property: "name",
        message: `${step.name} is reserved for rating inputs`,
      });
    }

    names.add(step.name);
  }

  if (!names.has(algorithm.premium)) {
    report({ coverage, property: "premium", message: `Unknown step ${algorithm.premium}` });
  }

  const references = new Map<string, string[]>();

  for (const step of algorithm.steps) {
    const where = { coverage, step: step.name };
    const refs = stepReferences(step, names);
    references.set(step.name, refs.steps);

    for (const error of refs.errors) report({ ...where, ...error });

    for (const ref of refs.steps) {
      if (!names.has(ref))
        report({ ...where, property: "operands", message: `Unknown step ${ref}` });
    }

    for (const path of refs.paths) {
      if (!ROOTS.has(rootOf(path))) {
        report({ ...where, property: "operands", message: `Unknown reference ${path}` });
      }
    }

    if (step.op === "lookup") {
      const table = tables.get(step.table);

      if (!table) report({ ...where, property: "table", message: `Unknown table ${step.table}` });
      else if (table.dimensions.length !== step.keys.length) {
        report({
          ...where,
          property: "keys",
          message: `${step.table} has ${table.dimensions.length} dimensions; got ${step.keys.length} keys`,
        });
      }
    }

    if (step.op === "sumCoverages") {
      for (const code of step.coverages) {
        if (code === coverage)
          report({ ...where, property: "coverages", message: "Can't sum its own premium" });
        else if (!covered.has(code)) {
          report({
            ...where,
            property: "coverages",
            message: "No algorithm for {coverage}",
            params: { coverage: { kind: "coverage", code } },
          });
        }
      }
    }
  }

  const { cyclic } = topologicalOrder(
    algorithm.steps.map((s) => s.name),
    (name) => references.get(name) ?? [],
  );

  if (cyclic.length) {
    report({ coverage, property: "steps", message: `Circular steps: ${cyclic.join(", ")}` });
  }
}

export function coverageDependencies(algorithm: CoverageAlgorithm): string[] {
  return algorithm.steps.flatMap((step) => (step.op === "sumCoverages" ? step.coverages : []));
}

export function structuralIssues(plan: RatingPlan): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const report = (issue: PlanIssue) => issues.push(issue);

  checkTables(plan, report);

  const coverages = new Set<string>();

  for (const algorithm of plan.algorithms) {
    if (coverages.has(algorithm.coverage)) {
      report({
        coverage: algorithm.coverage,
        property: "coverage",
        message: "Duplicate algorithm",
      });
    }

    coverages.add(algorithm.coverage);
    checkAlgorithm(plan, algorithm, report);
  }

  const byCoverage = new Map(plan.algorithms.map((a) => [a.coverage, a]));

  const { cyclic } = topologicalOrder([...byCoverage.keys()], (code) =>
    coverageDependencies(byCoverage.get(code)!).filter((dep) => dep !== code),
  );

  if (cyclic.length) {
    report({
      property: "algorithms",
      message: `Coverages sum each other in a cycle: ${cyclic.join(", ")}`,
    });
  }

  return issues;
}

export function pathResolver(paths: PathResolver): (path: string) => boolean {
  if (typeof paths === "function") return paths;

  const set = new Set(paths);

  return (path) => set.has(path);
}

const canonical = (path: string) => path.replace(/\[\d+\]/g, "[]");

function schemaPathOf(path: string, exposure: string | undefined): string | undefined {
  const root = rootOf(path);
  const rest = path.slice(root.length).replace(/^\./, "");

  if (root === "risk") return canonical(rest);

  if (root === "exposure" && exposure) return rest ? `${exposure}.${canonical(rest)}` : exposure;

  return undefined;
}

export function checkRatingPlan(
  plan: unknown,
  schemaPaths: PathResolver,
  coverageCodes: Iterable<string>,
): PlanIssue[] {
  const parsed = ratingPlanSchema.safeParse(plan);

  if (!parsed.success) {
    return parsed.error.issues.map((issue) => ({
      property: issue.path.join("."),
      message: issue.message,
    }));
  }

  const issues = structuralIssues(parsed.data);
  const known = pathResolver(schemaPaths);
  const codes = new Set(coverageCodes);

  for (const algorithm of parsed.data.algorithms) {
    const coverage = algorithm.coverage;

    if (!codes.has(coverage)) {
      issues.push({ coverage, property: "coverage", message: `Unknown coverage ${coverage}` });
    }

    if (algorithm.exposure && !known(algorithm.exposure)) {
      issues.push({
        coverage,
        property: "exposure",
        message: `Unknown path ${algorithm.exposure}`,
      });
    }

    const names = new Set(algorithm.steps.map((s) => s.name));

    for (const step of algorithm.steps) {
      for (const path of stepReferences(step, names).paths) {
        const where = { coverage, step: step.name, property: "operands" };

        if (rootOf(path) === "exposure" && !algorithm.exposure) {
          issues.push({ ...where, message: `${path} needs the algorithm's exposure` });

          continue;
        }

        const schemaPath = schemaPathOf(path, algorithm.exposure);

        if (schemaPath !== undefined && !known(schemaPath)) {
          issues.push({ ...where, message: `Unknown path ${path}` });
        }

        const code = /^coverages\.([^.[]+)/.exec(path)?.[1];

        if (code && !codes.has(code))
          issues.push({ ...where, message: `Unknown coverage ${code}` });
      }
    }
  }

  return issues;
}
