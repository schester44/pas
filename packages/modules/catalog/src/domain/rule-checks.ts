import {
  checkDecision,
  DECISION_KINDS,
  type DecisionKind,
  evaluateDecision,
  kindContextPaths,
} from "@pas/decisions-engine";
import { type RiskSchema, schemaIndex } from "@pas/forms-core";
import { canonicalJson } from "@pas/kernel";
import type { CheckIssue } from "./checks";
import {
  type DecisionTest,
  decisionRef,
  type VersionContents,
  type VersionDecision,
} from "./version-contents";

const DECISION_KEY = /^[a-z][a-z0-9_]*$/;

/** Decisions see the risk data plus the jurisdiction being quoted. */
export const DECISION_CONTEXT_PATHS = [
  "jurisdiction",
  "jurisdiction.country",
  "jurisdiction.subdivision",
] as const;

export function decisionInputPaths(schema: RiskSchema, kind?: DecisionKind): string[] {
  return [
    ...schemaIndex(schema).keys(),
    ...DECISION_CONTEXT_PATHS,
    ...(kind ? kindContextPaths(kind) : []),
  ];
}

export type DecisionTestResult =
  | { passed: boolean; actual: unknown }
  | { passed: false; error: string };

export function runDecisionTest(decision: VersionDecision, test: DecisionTest): DecisionTestResult {
  try {
    const { result } = evaluateDecision(decision.kind, decision.decision, test.input);
    const actual: unknown = JSON.parse(JSON.stringify(result ?? null));

    return { passed: canonicalJson(actual) === canonicalJson(test.expected ?? null), actual };
  } catch (cause) {
    return { passed: false, error: (cause as Error).message };
  }
}

export function checkRules(contents: VersionContents): CheckIssue[] {
  const issues: CheckIssue[] = [];
  const seen = new Set<string>();

  for (const decision of contents.rules) {
    const ref = decisionRef(decision);
    const label = decision.name || ref;
    const target = { area: "rules" as const, decision: ref };

    if (!DECISION_KEY.test(decision.key)) {
      issues.push(error(target, "Use lowercase letters, digits and _ for the decision key"));
    }

    if (seen.has(ref)) {
      issues.push(error(target, `There's more than one ${ref} decision`));
      continue;
    }

    seen.add(ref);

    const found = checkDecision(
      decision.kind,
      decision.decision,
      decisionInputPaths(contents.riskSchema, decision.kind),
    );

    for (const issue of found) {
      issues.push({
        severity: issue.severity,
        message: `${label}: ${issue.message}`,
        target: {
          ...target,
          ...(issue.nodeId && { node: issue.nodeId }),
          ...(issue.ruleId && { rule: issue.ruleId }),
        },
      });
    }

    if (found.some((issue) => issue.severity === "error")) continue;

    for (const test of decision.tests) {
      const run = runDecisionTest(decision, test);

      if (run.passed) continue;

      issues.push(
        error(
          { ...target, test: test.id },
          "error" in run
            ? `${label}: test “${test.name}” can't run: ${run.error}`
            : `${label}: test “${test.name}” doesn't return the expected result`,
        ),
      );
    }
  }

  if (!contents.rules.some((decision) => decision.kind === "underwriting")) {
    issues.push({
      severity: "warning",
      target: { area: "rules" },
      message: `Add an ${DECISION_KINDS.underwriting.label.toLowerCase()} decision so risks can be referred or declined`,
    });
  }

  return issues;
}

function error(target: CheckIssue["target"], message: string): CheckIssue {
  return { severity: "error", target, message };
}
