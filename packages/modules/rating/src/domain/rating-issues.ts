import { indexSchema, type RiskSchema } from "@pas/forms-core";
import type { MessageParams } from "@pas/kernel";
import {
  checkBindingManifest,
  checkRatingPlan,
  type GoldenCaseResult,
  type GoldenReport,
  type PlanIssue,
  type RatingConfig,
  type WorkbookModel,
} from "@pas/rating-engine";

export type RatingSection = "engine" | "tables" | "algorithms" | "workbook" | "manifest" | "golden";

export interface RatingIssue {
  severity: "error" | "warning";
  message: string;
  params?: MessageParams;
  target: {
    section: RatingSection;
    coverage?: string;
    table?: string;
    step?: string;
    golden?: string;
    property?: string;
  };
}

/** Schema paths as the rating engines address them: repeatables also as `path[]`. */
export function ratingPaths(schema: RiskSchema): string[] {
  return [...indexSchema(schema)].flatMap(([path, node]) =>
    node.kind === "repeatable" ? [path, `${path}[]`] : [path],
  );
}

const error = (
  target: RatingIssue["target"],
  message: string,
  params?: MessageParams,
): RatingIssue => ({
  severity: "error",
  target,
  message,
  ...(params && { params }),
});

const coverageParam = (code: string): MessageParams => ({ coverage: { kind: "coverage", code } });

function planIssue(issue: PlanIssue): RatingIssue {
  const section = issue.table ? "tables" : issue.coverage ? "algorithms" : "engine";

  return error(
    {
      section,
      ...(issue.coverage && { coverage: issue.coverage }),
      ...(issue.table && { table: issue.table }),
      ...(issue.step && { step: issue.step }),
      ...(issue.property && { property: issue.property }),
    },
    issue.message,
    issue.params,
  );
}

export function rateableCoverages(
  rating: RatingConfig,
  coverageCodes: readonly string[] = [],
): Set<string> {
  if (rating.engine === "plan") return new Set(rating.plan.algorithms.map((a) => a.coverage));

  // An extension prices whatever is selected; its golden cases are what prove it.
  if (rating.engine === "extension") return new Set(coverageCodes);

  return new Set(
    rating.manifest.outputs.flatMap((output) =>
      output.kind === "premium" ? [output.coverage] : [],
    ),
  );
}

/** Checks that need no workbook bytes and no rating run. */
export function staticIssues(
  rating: RatingConfig | null,
  schema: RiskSchema,
  coverageCodes: readonly string[],
  workbook: WorkbookModel | null,
): RatingIssue[] {
  if (!rating) {
    return coverageCodes.length
      ? [error({ section: "engine" }, "Choose a rating engine and rate every coverage")]
      : [];
  }

  const paths = ratingPaths(schema);
  const issues: RatingIssue[] = [];

  if (rating.engine === "plan") {
    issues.push(...checkRatingPlan(rating.plan, paths, coverageCodes).map(planIssue));
  } else if (rating.engine === "extension") {
    if (!rating.extensionVersionId) {
      issues.push(error({ section: "engine" }, "Choose an extension version to rate with"));
    }
  } else if (!rating.workbookId) {
    issues.push(error({ section: "workbook" }, "Upload or choose a rater workbook"));
  } else if (!workbook) {
    issues.push(error({ section: "workbook" }, "The rater workbook can't be found"));
  } else {
    for (const issue of checkBindingManifest(rating.manifest, workbook, paths, coverageCodes)) {
      issues.push(
        error(
          { section: "manifest", ...(issue.property && { property: issue.property }) },
          issue.message,
          issue.params,
        ),
      );
    }
  }

  const rated = rateableCoverages(rating, coverageCodes);

  for (const code of coverageCodes) {
    if (rated.has(code)) continue;

    issues.push(
      error(
        { section: rating.engine === "plan" ? "algorithms" : "manifest", coverage: code },
        rating.engine === "plan"
          ? "Add an algorithm for {coverage}"
          : "Bind a premium output for {coverage}",
        coverageParam(code),
      ),
    );
  }

  if (rating.goldenCases.length === 0) {
    issues.push({
      severity: "warning",
      target: { section: "golden" },
      message: "Add golden cases so rate changes are caught before publishing",
    });
  }

  return issues;
}

function describeFailure(result: GoldenCaseResult): { message: string; params?: MessageParams } {
  if (result.error)
    return { message: `Golden case “${result.name}” can't be rated: ${result.error}` };

  const [first] = result.diffs;
  const more = result.diffs.length > 1 ? ` (+${result.diffs.length - 1} more)` : "";

  if (!first) return { message: `Golden case “${result.name}” fails` };

  const outcome = `expected ${first.expected}, got ${first.actual ?? "nothing"}${more}`;
  const premium = /^premium ([^@]+)(?:@(.+))?$/.exec(first.field);

  if (!premium) return { message: `Golden case “${result.name}”: ${first.field} ${outcome}` };

  return {
    message: `Golden case “${result.name}”: {coverage} premium${premium[2] ? ` for ${premium[2]}` : ""} ${outcome}`,
    params: coverageParam(premium[1]!),
  };
}

export function goldenIssues(rating: RatingConfig, report: GoldenReport): RatingIssue[] {
  return report.cases.flatMap((result, i) => {
    if (result.passed) return [];

    const { message, params } = describeFailure(result);

    return [error({ section: "golden", golden: rating.goldenCases[i]?.id }, message, params)];
  });
}
