import { type CompiledDecision, compileDecision, type DecisionTrace, runGraph } from "./graph";
import type { JdmDecision } from "./jdm";
import { aggregate, type DecisionKind, type DecisionResult } from "./kinds";

export { checkDecision, readPaths, type DecisionIssue, type DecisionIssueCode } from "./check";
export { DecisionError, type DecisionErrorCode } from "./errors";
export {
  compileDecision,
  parseJdm,
  type CompiledDecision,
  type DecisionTrace,
  type MatchedRule,
  type NodeTrace,
} from "./graph";
export * from "./jdm";
export {
  aggregate,
  CHANNEL_KINDS,
  contractFields,
  DUE_FROM,
  OBLIGATION_KINDS,
  REPORT_FREQUENCIES,
  type ChannelKind,
  type DueFrom,
  type ObligationKind,
  type ReportFrequency,
  DECISION_KIND_KEYS,
  DECISION_KINDS,
  kindContextPaths,
  overallOutcome,
  rowsOf,
  UNDERWRITING_OUTCOMES,
  type ContractField,
  type ContractIssue,
  type DecisionKind,
  type DecisionResult,
  type UnderwritingOutcome,
} from "./kinds";

export interface EvaluateOptions {
  trace?: boolean;
  cacheKey?: string;
}

export interface Evaluation<K extends DecisionKind> {
  result: DecisionResult<K>;
  raw: unknown;
  trace?: DecisionTrace;
  durationMs: number;
}

const isCompiled = (artifact: JdmDecision | CompiledDecision): artifact is CompiledDecision =>
  "order" in artifact && "incoming" in artifact;

export function evaluateDecision<K extends DecisionKind>(
  kind: K,
  artifact: JdmDecision | CompiledDecision,
  input: Record<string, unknown>,
  options: EvaluateOptions = {},
): Evaluation<K> {
  const start = performance.now();

  const compiled = isCompiled(artifact)
    ? artifact
    : compileDecision(artifact, options.cacheKey ? { cacheKey: options.cacheKey } : {});

  const run = runGraph(compiled, input, { trace: options.trace ?? false });
  const result = aggregate(kind, run.output);

  return {
    result,
    raw: run.output,
    ...(run.trace ? { trace: run.trace } : {}),
    durationMs: performance.now() - start,
  };
}
