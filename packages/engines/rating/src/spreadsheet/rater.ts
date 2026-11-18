import { Money } from "@pas/kernel";
import {
  RatingError,
  type Rater,
  type RaterArtifact,
  type RatingInput,
  type RatingResult,
  type TraceValue,
  type WorksheetStep,
} from "../contract";
import { exposuresOf, fromFloat, ratingContext, readPath, toDecimal } from "../context";
import type { CellLocation, WorkbookEngine } from "./engine";
import {
  bindingManifestSchema,
  targetLabel,
  type BindingManifest,
  type InputBinding,
  type OutputBinding,
} from "./manifest";
import type { CellValue, WorkbookModel } from "./model";
import { warmEngine } from "./warm";

const EXCEL_EPOCH = Temporal.PlainDate.from("1899-12-30");

function transformed(binding: InputBinding, raw: unknown): CellValue {
  const value = raw === undefined || raw === null || raw === "" ? (binding.default ?? null) : raw;

  if (value === null) {
    if (binding.required)
      throw new RatingError(`${binding.path} is required by the workbook`, { path: binding.path });

    return null;
  }

  const transform = binding.transform;

  if (!transform) {
    if (typeof value === "number" || typeof value === "string" || typeof value === "boolean")
      return value;

    throw new RatingError(`${binding.path} isn't a single value`, { path: binding.path });
  }

  switch (transform.kind) {
    case "map": {
      const mapped = transform.map[String(value)] ?? transform.default;

      if (mapped === undefined) {
        throw new RatingError(`${binding.path} has no code for ${String(value)}`, {
          path: binding.path,
        });
      }

      return mapped;
    }

    case "boolean":
      return value === true || value === "true" ? transform.true : transform.false;

    case "excelDate":
      return EXCEL_EPOCH.until(Temporal.PlainDate.from(String(value)), { largestUnit: "days" })
        .days;

    case "number":
      return toDecimal(value, binding.path).toNumber();
  }
}

const traceValue = (value: CellValue): TraceValue =>
  value !== null && typeof value === "object" ? value.error : value;

const rawTrace = (value: unknown): TraceValue =>
  value === undefined || value === null || typeof value !== "object"
    ? ((value ?? null) as TraceValue)
    : JSON.stringify(value);

interface BoundInput {
  binding: InputBinding;
  location: CellLocation;
}

interface BoundOutput {
  binding: OutputBinding;
  location: CellLocation;
  chain: number[];
}

function bind(engine: WorkbookEngine, label: string): CellLocation {
  const location = engine.locate(label);

  if (!location) throw new RatingError(`${label} isn't a cell or single-cell name in the workbook`);

  return location;
}

export function createSpreadsheetRater(workbook: WorkbookModel, source: BindingManifest): Rater {
  const manifest = bindingManifestSchema.parse(source);
  const engine = warmEngine(workbook);

  if (engine.problems.length) {
    throw new RatingError(`Workbook ${workbook.hash} can't be rated`, {
      problems: engine.problems,
    });
  }

  const inputs: BoundInput[] = manifest.inputs.map((binding) => {
    const location = bind(engine, targetLabel(binding.target));

    if (engine.formulaAt(location.key))
      throw new RatingError(`${location.address} holds a formula`);

    return { binding, location };
  });

  const outputs: BoundOutput[] = manifest.outputs.map((binding) => {
    const location = bind(engine, targetLabel(binding.source));

    return { binding, location, chain: engine.upstream(location.key) };
  });

  const artifact: RaterArtifact = {
    kind: "spreadsheet",
    key: manifest.key,
    version: manifest.version,
    hash: workbook.hash,
  };

  const run = (input: RatingInput, exposure: string | undefined, result: RatingResult) => {
    const context = ratingContext(input, exposure);
    const session = engine.session();
    const worksheet: WorksheetStep[] = [];
    const where = { exposure };

    for (const { binding, location } of inputs) {
      const raw = readPath(context, binding.path);
      const value = transformed(binding, raw);
      session.setKey(location.key, value);

      worksheet.push({
        ...where,
        name: location.address,
        operation: "input",
        inputs: [{ ref: binding.path, value: rawTrace(raw) }],
        output: traceValue(value),
      });
    }

    session.recalculate();

    const selected = new Set(
      input.coverages.filter((s) => s.exposure === exposure).map((s) => s.coverage),
    );

    const traced = new Set<number>();

    for (const { binding, location, chain } of outputs) {
      if (binding.coverage !== undefined && !selected.has(binding.coverage)) continue;

      for (const order of chain) {
        if (traced.has(order)) continue;

        traced.add(order);
        const formula = engine.formulas[order]!;

        worksheet.push({
          ...where,
          coverage: binding.coverage,
          name: formula.address,
          operation: `=${formula.text}`,
          inputs: formula.refs.map((ref) => ({
            ref: ref.label,
            value: ref.key === undefined ? "range" : traceValue(session.getKey(ref.key)),
          })),
          output: traceValue(session.getKey(formula.key)),
        });
      }

      const value = session.getKey(location.key);

      if (value !== null && typeof value === "object") {
        throw new RatingError(`${targetLabel(binding.source)} evaluates to ${value.error}`, {
          cell: location.address,
          exposure,
        });
      }

      const decimal =
        typeof value === "number"
          ? fromFloat(value)
          : toDecimal(value, targetLabel(binding.source));

      if (binding.kind === "premium") {
        const premium = Money.of(decimal, input.currency).round(
          manifest.rounding.places,
          manifest.rounding.mode,
        );

        result.coverages.push({
          coverage: binding.coverage,
          exposure,
          premium,
          calculated: premium,
        });
      } else {
        result.factors.push({
          name: binding.name,
          coverage: binding.coverage,
          exposure,
          value: decimal.toFixed(),
        });
      }
    }

    result.worksheet.push(...worksheet);
  };

  return {
    artifact,
    async rate(input) {
      if (input.currency !== manifest.currency) {
        throw new RatingError(
          `Workbook ${manifest.key} rates in ${manifest.currency}, not ${input.currency}`,
        );
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

      for (const exposure of exposuresOf(input)) run(input, exposure, result);

      const rated = new Set(result.coverages.map((c) => c.coverage));
      const missing = input.coverages.filter((selection) => !rated.has(selection.coverage));

      if (missing.length) {
        throw new RatingError(
          `The workbook has no premium output for ${missing.map((s) => s.coverage).join(", ")}`,
        );
      }

      result.total = result.coverages.reduce(
        (sum, c) => sum.plus(c.premium),
        Money.zero(input.currency),
      );

      return result;
    },
  };
}
