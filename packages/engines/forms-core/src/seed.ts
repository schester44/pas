import type { FormDefinition } from "./form";
import { getAt, setAt } from "./paths";
import type { RiskSchema } from "./schema";
import { schemaIndex } from "./evaluate";
import { newRow } from "./rows";

export function withMinimumEntries<T>(schema: RiskSchema, form: FormDefinition, data: T): T {
  const index = schemaIndex(schema);
  let seeded: unknown = data;

  for (const step of form.steps) {
    for (const section of step.sections) {
      if (!section.repeat) continue;

      const node = index.get(section.repeat);
      const minimum = node?.kind === "repeatable" ? (node.minItems ?? 0) : 0;
      const rows = (getAt(seeded, section.repeat) as unknown[] | undefined) ?? [];

      if (rows.length >= minimum) continue;

      const padding = Array.from({ length: minimum - rows.length }, newRow);
      seeded = setAt(seeded, section.repeat, [...rows, ...padding]);
    }
  }

  return seeded as T;
}
