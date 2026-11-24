import { StatusChip } from "@pas/ui/components/status-chip";
import type { TestReport } from "./extension-editor";
import { pointLabel } from "./labels";

/** Each test's outcome, failures first, plus declared points that have no test. */
export function TestReportList({ report }: { report: TestReport }) {
  const results = report.results.toSorted((a, b) => Number(a.passed) - Number(b.passed));

  return (
    <div className="grid gap-2">
      {report.missing.map((point) => (
        <div
          key={point}
          className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
        >
          <span>{pointLabel(point)} has no test</span>
          <StatusChip tone="warning">Missing</StatusChip>
        </div>
      ))}
      {results.map((result) => (
        <div key={result.testId} className="grid gap-1 rounded-lg border px-3 py-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">{result.name}</span>
            <span className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground tabular-nums">
                {result.durationMs} ms
              </span>
              <StatusChip tone={result.passed ? "success" : "danger"}>
                {result.passed ? "Passed" : "Failed"}
              </StatusChip>
            </span>
          </div>
          {result.problems.map((problem) => (
            <p key={problem} className="m-0 text-xs text-red-800">
              {problem}
            </p>
          ))}
        </div>
      ))}
      {results.length === 0 && report.missing.length === 0 && (
        <p className="m-0 text-sm text-muted-foreground">No tests ran.</p>
      )}
    </div>
  );
}
