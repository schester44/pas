import type { ExtensionPoint } from "@pas/extension-points";
import { canonicalJson } from "@pas/kernel";

export interface RecordedExchange {
  request: { method: string; url: string; headers: Record<string, string>; body: string | null };
  response:
    | { status: number; url: string; headers: Record<string, string>; body: string }
    | { error: string };
  durationMs: number;
}

/** A fixture: an input, what the extension should return, and the network it may answer from. */
export interface ExtensionTest {
  id: string;
  name: string;
  point: ExtensionPoint;
  input: unknown;
  /** When set, the output must equal it exactly. */
  expected?: unknown;
  expectFailure?: boolean;
  network: RecordedExchange[];
}

export interface TestResult {
  testId: string;
  name: string;
  point: ExtensionPoint;
  passed: boolean;
  problems: string[];
  output: unknown;
  logs: { level: string; message: string }[];
  durationMs: number;
}

export interface TestReport {
  ranAt: string;
  passed: boolean;
  results: TestResult[];
  /** Declared points without a single test. */
  missing: ExtensionPoint[];
}

export interface TestRun {
  ok: boolean;
  output: unknown;
  error: string | null;
}

export function judge(test: ExtensionTest, run: TestRun): string[] {
  if (test.expectFailure) return run.ok ? ["Expected the extension to fail, but it succeeded"] : [];

  if (!run.ok) return [run.error ?? "The extension failed"];

  if (test.expected !== undefined && canonicalJson(test.expected) !== canonicalJson(run.output)) {
    return ["The output doesn't match the expected output"];
  }

  return [];
}

export function reportOf(
  points: readonly ExtensionPoint[],
  results: TestResult[],
  ranAt: string,
): TestReport {
  const missing = points.filter((point) => !results.some((r) => r.point === point));

  return {
    ranAt,
    passed: missing.length === 0 && results.every((r) => r.passed),
    results,
    missing,
  };
}
