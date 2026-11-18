import type { RoundingMode } from "@pas/kernel";
import { z } from "zod";
import type { Scalar } from "../contract";
import { CONTEXT_ROOTS } from "../context";
import { pathResolver, rootOf, type PathResolver, type PlanIssue } from "../plan/check";
import { warmEngine } from "./warm";
import type { WorkbookModel } from "./model";

export type CellTarget = { cell: string } | { name: string };

export type Transform =
  | { kind: "map"; map: Record<string, string | number>; default?: string | number }
  | { kind: "boolean"; true: string | number; false: string | number }
  | { kind: "excelDate" }
  | { kind: "number" };

export interface InputBinding {
  path: string;
  target: CellTarget;
  transform?: Transform;
  default?: Scalar;
  required?: boolean;
}

export type OutputBinding =
  | { source: CellTarget; kind: "premium"; coverage: string }
  | { source: CellTarget; kind: "factor"; name: string; coverage?: string };

/** `exposure` is the RiskSchema path of the exposure the workbook rates (e.g. `locations[]`); it runs once per exposure. */
export interface BindingManifest {
  key: string;
  version: string;
  currency: string;
  exposure?: string;
  rounding: { mode: RoundingMode; places: number };
  inputs: InputBinding[];
  outputs: OutputBinding[];
}

const target: z.ZodType<CellTarget> = z.union([
  z.object({ cell: z.string().min(1) }).strict(),
  z.object({ name: z.string().min(1) }).strict(),
]);

const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const transform: z.ZodType<Transform> = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("map"),
    map: z.record(z.string(), z.union([z.string(), z.number()])),
    default: z.union([z.string(), z.number()]).optional(),
  }),
  z.object({
    kind: z.literal("boolean"),
    true: z.union([z.string(), z.number()]),
    false: z.union([z.string(), z.number()]),
  }),
  z.object({ kind: z.literal("excelDate") }),
  z.object({ kind: z.literal("number") }),
]);

export const bindingManifestSchema: z.ZodType<BindingManifest> = z.object({
  key: z.string().min(1),
  version: z.string().min(1),
  currency: z.string().length(3),
  exposure: z.string().optional(),
  rounding: z.object({
    mode: z.enum(["half_up", "half_even", "up", "down"]),
    places: z.number().int().min(0).max(10),
  }),
  inputs: z.array(
    z.object({
      path: z.string().min(1),
      target,
      transform: transform.optional(),
      default: scalar.optional(),
      required: z.boolean().optional(),
    }),
  ),
  outputs: z
    .array(
      z.discriminatedUnion("kind", [
        z.object({ source: target, kind: z.literal("premium"), coverage: z.string().min(1) }),
        z.object({
          source: target,
          kind: z.literal("factor"),
          name: z.string().min(1),
          coverage: z.string().optional(),
        }),
      ]),
    )
    .min(1),
});

export const targetLabel = (t: CellTarget) => ("cell" in t ? t.cell : t.name);

const ROOTS = new Set<string>(CONTEXT_ROOTS);

export function checkBindingManifest(
  manifest: unknown,
  workbook: WorkbookModel,
  schemaPaths: PathResolver,
  coverageCodes: Iterable<string>,
): PlanIssue[] {
  const parsed = bindingManifestSchema.safeParse(manifest);

  if (!parsed.success) {
    return parsed.error.issues.map((issue) => ({
      property: issue.path.join("."),
      message: issue.message,
    }));
  }

  const issues: PlanIssue[] = [];
  const engine = warmEngine(workbook);
  const known = pathResolver(schemaPaths);
  const codes = new Set(coverageCodes);
  const exposure = parsed.data.exposure;

  parsed.data.inputs.forEach((binding, i) => {
    const property = `inputs[${i}]`;
    const location = engine.locate(targetLabel(binding.target));

    if (!location)
      issues.push({
        property,
        message: `${targetLabel(binding.target)} isn't a cell or single-cell name`,
      });
    else if (engine.formulaAt(location.key)) {
      issues.push({
        property,
        message: `${location.address} holds a formula; bind inputs to value cells`,
      });
    }

    const root = rootOf(binding.path);
    const rest = binding.path.slice(root.length + 1).replace(/\[\d+\]/g, "[]");

    if (!ROOTS.has(root)) issues.push({ property, message: `Unknown reference ${binding.path}` });
    else if (root === "risk" && !known(rest))
      issues.push({ property, message: `Unknown path ${binding.path}` });
    else if (root === "exposure") {
      if (!exposure)
        issues.push({ property, message: `${binding.path} needs the manifest's exposure` });
      else if (!known(`${exposure}.${rest}`))
        issues.push({ property, message: `Unknown path ${binding.path}` });
    }

    const code = /^coverages\.([^.[]+)/.exec(binding.path)?.[1];

    if (code && !codes.has(code)) issues.push({ property, message: `Unknown coverage ${code}` });
  });

  parsed.data.outputs.forEach((binding, i) => {
    const property = `outputs[${i}]`;
    const location = engine.locate(targetLabel(binding.source));

    if (!location)
      issues.push({
        property,
        message: `${targetLabel(binding.source)} isn't a cell or single-cell name`,
      });

    if (binding.coverage && !codes.has(binding.coverage)) {
      issues.push({ property, message: `Unknown coverage ${binding.coverage}` });
    }
  });

  return issues;
}
