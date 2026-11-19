import { type FormDefinition, getAt, rowIdOf, rowPath } from "@pas/forms-core";

interface EndorsementShape {
  form: FormDefinition | null;
  offers: { attachesTo: { level: "policy" } | { level: "exposure"; path: string } }[];
  exposureLabels: Record<string, string>;
}

/**
 * The exposures an endorsement form is editing, keyed by row id like the policy's coverages,
 * with the server's names and "Location 3" for rows added in this change.
 */
export function endorsedExposures(setup: EndorsementShape, risk: Record<string, unknown>) {
  const paths = new Set(
    setup.offers.flatMap((o) => (o.attachesTo.level === "exposure" ? [o.attachesTo.path] : [])),
  );

  const labels: Record<string, string> = { ...setup.exposureLabels };

  const keys = Object.fromEntries(
    [...paths].map((path) => {
      const rows = getAt(risk, path);
      const list = Array.isArray(rows) ? rows : [];

      const noun =
        setup.form?.steps
          .flatMap((step) => step.sections)
          .find((section) => section.repeat === path)?.itemLabel ?? "Entry";

      return [
        path,
        list.map((row, i) => {
          const id = rowIdOf(row);
          const key = id ? rowPath(path, id) : `${path}[${i}]`;
          labels[key] ??= `${noun} ${i + 1}`;

          return key;
        }),
      ];
    }),
  );

  return { keys, labels };
}

/** Issued endorsements dated after `date`: a change dated then re-rates them (PLAN §7.4). */
export const laterChanges = (
  setup: { issued: { transactionId: string; type: string; effectiveDate: string }[] },
  date: string,
) => setup.issued.filter((c) => c.type === "ENDORSEMENT" && c.effectiveDate > date);
