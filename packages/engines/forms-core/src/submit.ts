import type { FormDefinition } from "./form";
import { evaluate, type EvaluateOptions, type FormState } from "./evaluate";
import { getAt, ROW_ID, rowIdOf, setAt } from "./paths";
import type { RiskSchema } from "./schema";

export interface Submission {
  ok: boolean;
  data: Record<string, unknown>;
  errors: Record<string, string[]>;
  state: FormState;
}

export function validateSubmission(
  schema: RiskSchema,
  form: FormDefinition,
  data: unknown,
  options: EvaluateOptions = {},
): Submission {
  const { state, values, repeats } = evaluate(schema, form, data, options);
  let output: Record<string, unknown> = {};

  for (const [path, count] of repeats) {
    const rows = getAt(data, path);

    output = setAt(
      output,
      path,
      Array.from({ length: count }, (_, i) => {
        const id = Array.isArray(rows) ? rowIdOf(rows[i]) : undefined;

        return id ? { [ROW_ID]: id } : {};
      }),
    );
  }

  for (const [path, value] of values) output = setAt(output, path, value);

  const errors: Record<string, string[]> = {};

  for (const item of Object.values(state.items)) {
    if (item.errors.length > 0) errors[item.path] = item.errors;
  }

  for (const step of state.steps) {
    for (const section of step.sections) {
      if (section.repeat && section.errors.length > 0) errors[section.repeat] = section.errors;
    }
  }

  return { ok: state.valid, data: output, errors, state };
}
