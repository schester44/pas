import { checkDocuments, type DocumentSet, type DocumentTarget } from "@pas/documents";
import { checkReferences, schemaIndex } from "@pas/forms-core";
import { jurisdictionCode, sameJurisdiction } from "@pas/kernel";
import { checkPayPlans } from "@pas/pay-plans";
import {
  type AvailabilityKind,
  type AvailabilityWindow,
  type DateWindow,
  windowFor,
  windowsOverlap,
} from "./availability";
import type { RatingIssue, RatingTarget } from "../ports/rating-verifier";
import type { CoverageDefinition, CoverageOptionSet } from "./coverage";
import { checkRules } from "./rule-checks";
import type { VersionContents, VersionForm } from "./version-contents";

export type CheckTarget =
  | { area: "overview"; jurisdiction?: string }
  | { area: "risk" }
  | {
      area: "forms";
      form: string;
      step?: string;
      section?: string;
      item?: string;
      property?: string;
    }
  | { area: "coverages"; coverage: number; field?: string }
  | {
      area: "documents";
      section: DocumentTarget["section"];
      key?: string;
      block?: string;
      variant?: number;
      property?: string;
    }
  | { area: "rules"; decision?: string; node?: string; rule?: string; test?: string }
  | { area: "billing"; plan?: string; field?: string }
  | ({ area: "rating" } & RatingTarget);

export interface CheckIssue {
  severity: "error" | "warning";
  message: string;
  target: CheckTarget;
}

export interface PublishedAvailability {
  version: string;
  availability: readonly AvailabilityWindow[];
}

const COVERAGE_CODE = /^[a-z][a-z0-9_]*$/;
const DECIMAL = /^\d+(\.\d+)?$/;

const KIND_LABEL: Record<AvailabilityKind, string> = {
  new_business: "New business",
  renewal: "Renewal",
};

export const formKey = (form: Pick<VersionForm, "channel" | "stage">) =>
  `${form.channel}.${form.stage}`;

export interface ResolvedReferences {
  formEditions?: ReadonlySet<string>;
  rating?: readonly RatingIssue[];
}

export function checkVersion(
  contents: VersionContents,
  published: readonly PublishedAvailability[],
  resolved: ResolvedReferences = {},
): CheckIssue[] {
  return [
    ...checkRiskSchema(contents),
    ...checkForms(contents),
    ...checkCoverages(contents),
    ...checkAvailability(contents.availability, published),
    ...checkVersionDocuments(contents, resolved.formEditions),
    ...checkRules(contents),
    ...checkBilling(contents),
    ...(resolved.rating ?? []).map((issue) => ({
      ...issue,
      target: { area: "rating" as const, ...issue.target },
    })),
  ];
}

export function scheduledEditionIds(documents: DocumentSet): string[] {
  return documents.schedule.flatMap((entry) =>
    entry.document.kind === "form" ? [entry.document.editionId] : [],
  );
}

function documentTarget(target: DocumentTarget): CheckTarget {
  switch (target.section) {
    case "templates": {
      const { template, ...rest } = target;

      return { area: "documents", key: template, ...rest };
    }
    case "clauses": {
      const { clause, ...rest } = target;

      return { area: "documents", key: clause, ...rest };
    }
    case "schedule": {
      const { entry, ...rest } = target;

      return { area: "documents", key: entry, ...rest };
    }
  }
}

function checkVersionDocuments(
  contents: VersionContents,
  formEditions: ReadonlySet<string> | undefined,
): CheckIssue[] {
  const { documents } = contents;

  const issues: CheckIssue[] = checkDocuments(
    contents.riskSchema,
    contents.coverages,
    documents,
    formEditions ? { formEditions } : {},
  ).map((issue) => ({ ...issue, target: documentTarget(issue.target) }));

  const declarations = new Set(
    documents.templates.filter((t) => t.kind === "declarations").map((t) => t.key),
  );

  const scheduled = documents.schedule.some(
    (entry) =>
      entry.document.kind === "template" &&
      declarations.has(entry.document.key) &&
      entry.attachTo.includes("new_business"),
  );

  if (!scheduled) {
    issues.push(
      error(
        { area: "documents", section: "schedule" },
        "Schedule a declarations template for new business",
      ),
    );
  }

  return issues;
}

function checkBilling(contents: VersionContents): CheckIssue[] {
  const term = (contents.lifecycle.term ?? {}) as { months?: unknown };
  const termMonths = typeof term.months === "number" ? term.months : 12;

  return checkPayPlans(contents.billing, { termMonths }).map(
    ({ severity, message, plan, field }) => ({
      severity,
      message,
      target: { area: "billing", ...(plan && { plan }), ...(field && { field }) },
    }),
  );
}

function checkRiskSchema(contents: VersionContents): CheckIssue[] {
  if (contents.riskSchema.fields.length > 0) return [];

  return [error({ area: "risk" }, "Add at least one field to the risk data")];
}

function checkForms(contents: VersionContents): CheckIssue[] {
  const issues: CheckIssue[] = [];
  const seen = new Set<string>();

  for (const entry of contents.forms) {
    const key = formKey(entry);

    if (seen.has(key)) {
      issues.push(error({ area: "forms", form: key }, `There's more than one ${key} question set`));
      continue;
    }

    seen.add(key);

    if (entry.form.steps.length === 0) {
      issues.push(
        error({ area: "forms", form: key }, "Add at least one step to this question set"),
      );
    }

    for (const issue of checkReferences(contents.riskSchema, entry.form)) {
      const { message, ...where } = issue;
      issues.push(error({ area: "forms", form: key, ...where }, message));
    }
  }

  return issues;
}

function checkCoverages(contents: VersionContents): CheckIssue[] {
  const issues: CheckIssue[] = [];
  const index = schemaIndex(contents.riskSchema);
  const codes = new Map<string, number>();

  contents.coverages.forEach((coverage, i) => {
    if (coverage.code && !codes.has(coverage.code)) codes.set(coverage.code, i);
  });

  contents.coverages.forEach((coverage, i) => {
    const at = (field: string) => ({ area: "coverages" as const, coverage: i, field });
    const report = (field: string, message: string) => issues.push(error(at(field), message));

    if (!coverage.name.trim()) report("name", "Give this coverage a name");

    if (!COVERAGE_CODE.test(coverage.code)) {
      report("code", "Use lowercase letters, digits and _ for the coverage code");
    } else if (codes.get(coverage.code) !== i) {
      report("code", `Another coverage already uses the code ${coverage.code}`);
    }

    if (coverage.attachesTo.level === "exposure") {
      const path = coverage.attachesTo.path;
      const node = index.get(path);

      if (!node) report("attachesTo", `Attaches to ${path}, which isn't in the risk data`);
      else if (node.kind !== "group" && node.kind !== "repeatable") {
        report("attachesTo", `Attaches to ${path}, which is a field, not a group or repeatable`);
      } else if (!node.exposure) {
        report("attachesTo", `Attaches to ${path}, which isn't marked as an exposure`);
      }
    }

    for (const code of new Set(coverage.dependsOn)) {
      if (code === coverage.code) report("dependsOn", "A coverage can't depend on itself");
      else if (!codes.has(code)) report("dependsOn", `Depends on ${code}, which doesn't exist`);
    }

    issues.push(...checkOptionSet(coverage.limitOptions, "limit", at("limitOptions")));

    issues.push(
      ...checkOptionSet(coverage.deductibleOptions, "deductible", at("deductibleOptions")),
    );
  });

  for (const cycle of dependencyCycles(contents.coverages, codes)) {
    issues.push(
      error(
        { area: "coverages", coverage: codes.get(cycle[0]!)!, field: "dependsOn" },
        `Coverages depend on each other in a loop: ${[...cycle, cycle[0]].join(" → ")}`,
      ),
    );
  }

  return issues;
}

function checkOptionSet(
  set: CoverageOptionSet | undefined,
  noun: string,
  target: CheckTarget,
): CheckIssue[] {
  if (!set) return [];

  if (set.options.length === 0) return [error(target, `Add a ${noun} option or remove ${noun}s`)];

  const issues: CheckIssue[] = [];

  if (!set.options[set.defaultIndex]) issues.push(error(target, `Choose a default ${noun}`));

  for (const option of set.options) {
    const value = option.kind === "money" ? option.amount : option.value;

    if (!DECIMAL.test(value)) issues.push(error(target, `${value} isn't a valid ${noun}`));
    else if (option.kind === "percent" && Number(value) > 100) {
      issues.push(error(target, `A ${noun} can't be more than 100%`));
    } else if (option.kind === "money" && !/^[A-Z]{3}$/.test(option.currency)) {
      issues.push(error(target, `${option.currency} isn't a currency code`));
    }
  }

  return issues;
}

function dependencyCycles(
  coverages: readonly CoverageDefinition[],
  codes: ReadonlyMap<string, number>,
): string[][] {
  const cycles: string[][] = [];
  const state = new Map<string, "visiting" | "done">();

  const visit = (code: string, trail: string[]) => {
    if (state.get(code) === "done") return;

    if (state.get(code) === "visiting") {
      cycles.push(trail.slice(trail.indexOf(code)));

      return;
    }

    state.set(code, "visiting");
    const coverage = coverages[codes.get(code)!]!;

    for (const next of coverage.dependsOn) {
      if (next !== code && codes.has(next)) visit(next, [...trail, code]);
    }

    state.set(code, "done");
  };

  for (const code of codes.keys()) visit(code, []);

  return cycles;
}

function checkAvailability(
  availability: readonly AvailabilityWindow[],
  published: readonly PublishedAvailability[],
): CheckIssue[] {
  if (availability.length === 0) {
    return [
      error({ area: "overview" }, "Add at least one jurisdiction where this version is available"),
    ];
  }

  const issues: CheckIssue[] = [];

  availability.forEach((window, i) => {
    const code = jurisdictionCode(window.jurisdiction);
    const target = { area: "overview" as const, jurisdiction: code };

    if (
      availability.findIndex((other) =>
        sameJurisdiction(other.jurisdiction, window.jurisdiction),
      ) !== i
    ) {
      issues.push(error(target, `${code} is listed more than once`));

      return;
    }

    for (const kind of ["new_business", "renewal"] as const) {
      const own = windowFor(window, kind);

      if (own.to && Temporal.PlainDate.compare(own.to, own.from) <= 0) {
        issues.push(error(target, `${KIND_LABEL[kind]} in ${code} ends before it starts`));
        continue;
      }

      for (const other of published) {
        const match = other.availability.find((w) =>
          sameJurisdiction(w.jurisdiction, window.jurisdiction),
        );

        if (!match) continue;

        const theirs = windowFor(match, kind);

        if (!windowsOverlap(own, theirs)) continue;

        issues.push(overlapIssue(target, kind, code, own, theirs, other.version));
      }
    }
  });

  return issues;
}

function overlapIssue(
  target: CheckTarget,
  kind: AvailabilityKind,
  code: string,
  own: DateWindow,
  theirs: DateWindow,
  version: string,
): CheckIssue {
  const label = `${KIND_LABEL[kind]} in ${code}`;

  if (own.from.equals(theirs.from)) {
    return error(
      target,
      `${label} starts on ${own.from.toString()}, the same day as published version ${version}. Pick a different start date.`,
    );
  }

  const later = Temporal.PlainDate.compare(own.from, theirs.from) > 0 ? "this version" : version;

  return {
    severity: "warning",
    target,
    message: `${label} overlaps published version ${version}. Where both apply, ${later} wins because it starts later.`,
  };
}

function error(target: CheckTarget, message: string): CheckIssue {
  return { severity: "error", target, message };
}
