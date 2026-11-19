import { DECISION_KINDS, type DecisionKind } from "@pas/decisions-engine";
import { jurisdictionName } from "@pas/ui/lib/jurisdictions";
import { type DocumentSection, documentTitle } from "./documents";
import { formTitle } from "./forms";
import type { CheckIssue, Contents } from "./version-editor";

export type IssueLink =
  | { to: "/products/$productId/versions/$versionId"; search: { jurisdiction?: string } }
  | { to: "/products/$productId/versions/$versionId/risk"; search: Record<string, never> }
  | { to: "/products/$productId/versions/$versionId/questions"; search: { form: string } }
  | { to: "/products/$productId/versions/$versionId/coverages"; search: { coverage: number } }
  | {
      to: "/products/$productId/versions/$versionId/documents";
      search: { section: DocumentSection; item?: string; block?: string };
    }
  | { to: "/products/$productId/versions/$versionId/rules"; search: { decision?: string } }
  | { to: "/products/$productId/versions/$versionId/rating"; search: RatingSearch }
  | { to: "/products/$productId/versions/$versionId/billing"; search: { plan?: string } };

export interface RatingSearch {
  section?: "rater" | "golden";
  table?: string;
  coverage?: string;
  golden?: string;
  settings?: boolean;
}

const RATING_SECTIONS: Record<string, string> = {
  engine: "Engine",
  tables: "Rate tables",
  algorithms: "Algorithms",
  workbook: "Workbook",
  manifest: "Bindings",
  golden: "Golden cases",
};

const COVERAGE_FIELDS: Record<string, string> = {
  name: "Name",
  code: "Code",
  attachesTo: "Attaches to",
  dependsOn: "Depends on",
  limitOptions: "Limits",
  deductibleOptions: "Deductibles",
};

export function describeIssue(
  issue: CheckIssue,
  contents: Contents,
): { area: string; where: string[]; link: IssueLink } {
  const target = issue.target;

  switch (target.area) {
    case "overview": {
      const window = contents.availability.find(
        (w) => (w.jurisdiction.subdivision ?? w.jurisdiction.country) === target.jurisdiction,
      );

      return {
        area: "Availability",
        where: window ? [jurisdictionName(window.jurisdiction)] : [],
        link: {
          to: "/products/$productId/versions/$versionId",
          search: target.jurisdiction ? { jurisdiction: target.jurisdiction } : {},
        },
      };
    }
    case "risk":
      return {
        area: "Risk data",
        where: [],
        link: { to: "/products/$productId/versions/$versionId/risk", search: {} },
      };
    case "forms": {
      const entry = contents.forms.find((f) => `${f.channel}.${f.stage}` === target.form);
      const step = entry?.form.steps.find((s) => s.id === target.step);
      const section = step?.sections.find((s) => s.id === target.section);

      return {
        area: "Questions",
        where: [
          entry ? formTitle(entry) : target.form,
          step?.title,
          section?.title,
          target.item,
        ].filter((part): part is string => !!part),
        link: {
          to: "/products/$productId/versions/$versionId/questions",
          search: { form: target.form },
        },
      };
    }
    case "documents": {
      const { documents } = contents;

      const label = { templates: "Templates", clauses: "Clauses", schedule: "Schedule" }[
        target.section
      ];

      const name =
        target.section === "templates"
          ? documents.templates.find((t) => t.key === target.key)?.title
          : target.section === "clauses"
            ? documents.clauses.find((c) => c.key === target.key)?.title
            : (() => {
                const entry = documents.schedule.find((e) => e.id === target.key);

                return entry && documentTitle(entry.document, documents.templates, []);
              })();

      return {
        area: "Documents",
        where: [label, name ?? target.key].filter((part): part is string => !!part),
        link: {
          to: "/products/$productId/versions/$versionId/documents",
          search: {
            section: target.section,
            ...(target.key && { item: target.key }),
            ...(target.block && { block: target.block }),
          },
        },
      };
    }
    case "rules": {
      const decision = contents.rules.find((d) => `${d.kind}.${d.key}` === target.decision);
      const test = decision?.tests.find((t) => t.id === target.test);

      return {
        area: "Rules",
        where: [
          decision ? DECISION_KINDS[decision.kind as DecisionKind].label : undefined,
          decision?.name,
          test?.name,
        ].filter((part): part is string => !!part),
        link: {
          to: "/products/$productId/versions/$versionId/rules",
          search: target.decision ? { decision: target.decision } : {},
        },
      };
    }
    case "rating": {
      const golden = contents.rating?.goldenCases.find((c) => c.id === target.golden);
      const coverage = contents.coverages.find((c) => c.code === target.coverage);

      return {
        area: "Rating",
        where: [
          RATING_SECTIONS[target.section],
          target.table,
          coverage?.name ?? target.coverage,
          target.step,
          golden?.name,
        ].filter((part): part is string => !!part),
        link: {
          to: "/products/$productId/versions/$versionId/rating",
          search: {
            section: target.section === "golden" ? "golden" : "rater",
            ...(target.table && { table: target.table }),
            ...(target.coverage && { coverage: target.coverage }),
            ...(target.golden && { golden: target.golden }),
          },
        },
      };
    }
    case "billing": {
      const plan = contents.billing.payPlans.find((p) => p.key === target.plan);

      return {
        area: "Billing",
        where: [plan?.label || target.plan].filter((part): part is string => !!part),
        link: {
          to: "/products/$productId/versions/$versionId/billing",
          search: target.plan ? { plan: target.plan } : {},
        },
      };
    }
    case "coverages": {
      const coverage = contents.coverages[target.coverage];

      return {
        area: "Coverages",
        where: [
          coverage?.name || coverage?.code || `Coverage ${target.coverage + 1}`,
          target.field ? COVERAGE_FIELDS[target.field] : undefined,
        ].filter((part): part is string => !!part),
        link: {
          to: "/products/$productId/versions/$versionId/coverages",
          search: { coverage: target.coverage },
        },
      };
    }
  }
}
