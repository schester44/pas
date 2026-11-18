import type { FormDefinition } from "./form";
import { evaluate, type EvaluateOptions, type FormState } from "./evaluate";
import { setAt } from "./paths";
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
    output = setAt(
      output,
      path,
      Array.from({ length: count }, () => ({})),
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
