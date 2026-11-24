import { StatusChip } from "@pas/ui/components/status-chip";
import type { RunDetail } from "./extension-editor";
import { prettyJson, RUN_STATUS } from "./labels";

function Code({ children }: { children: string }) {
  return (
    <pre className="m-0 max-h-80 overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-5">
      {children}
    </pre>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-2">
      <h3 className="m-0 text-sm leading-5 font-medium">{title}</h3>
      {children}
    </section>
  );
}

/** One run: outcome, output, logs and every network exchange (credentials never recorded). */
export function RunResult({ run }: { run: RunDetail }) {
  const status = RUN_STATUS[run.status] ?? { label: run.status, tone: "neutral" as const };

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <StatusChip tone={status.tone}>{status.label}</StatusChip>
        <span className="text-muted-foreground tabular-nums">
          {run.stats.wallMs} ms · {run.stats.cpuMs} ms CPU · {run.stats.hostCalls} host calls
        </span>
      </div>
      {run.error && (
        <p className="m-0 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          {run.error.message}
        </p>
      )}
      {run.output !== null && (
        <Section title="Output">
          <Code>{prettyJson(run.output)}</Code>
        </Section>
      )}
      <Section title="Input">
        <Code>{prettyJson(run.input)}</Code>
      </Section>
      {run.logs.length > 0 && (
        <Section title="Logs">
          <Code>{run.logs.map((l) => `${l.level.padEnd(5)} ${l.message}`).join("\n")}</Code>
        </Section>
      )}
      {run.network.length > 0 && (
        <Section title="Network">
          <div className="grid gap-2">
            {run.network.map((exchange, i) => (
              <details key={i} className="rounded-lg border px-3 py-2 text-sm">
                <summary className="flex cursor-pointer items-center justify-between gap-3">
                  <span className="min-w-0 truncate font-mono text-xs">
                    {exchange.request.method} {exchange.request.url}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {"error" in exchange.response ? "Failed" : exchange.response.status} ·{" "}
                    {exchange.durationMs} ms
                  </span>
                </summary>
                <div className="mt-2 grid gap-2">
                  {exchange.request.body && <Code>{exchange.request.body}</Code>}
                  <Code>
                    {"error" in exchange.response
                      ? exchange.response.error
                      : exchange.response.body}
                  </Code>
                </div>
              </details>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
