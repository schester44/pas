import { Notice } from "@pas/ui/components/notice";
import { PageBody } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, CircleCheck } from "lucide-react";
import { IssueDot } from "@/components/catalog/issue-dot";
import { describeIssue } from "@/components/catalog/issues";
import { useVersionEditor } from "@/components/catalog/version-editor";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/products/$productId/versions/$versionId/checks")({
  component: ChecksTab,
});

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

function ChecksTab() {
  const trpc = useTRPC();
  const { version, contents, saveState } = useVersionEditor();
  const checks = useQuery(trpc.catalog.versions.check.queryOptions({ id: version.id }));
  const params = { productId: version.productId, versionId: version.id };

  const issues = checks.data ?? [];
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  const sorted = [...errors, ...warnings];

  const summary = !checks.data
    ? undefined
    : errors.length > 0
      ? `${plural(errors.length, "error")} to fix before publishing${warnings.length ? ` · ${plural(warnings.length, "warning")}` : ""}`
      : warnings.length > 0
        ? `Ready to publish · ${plural(warnings.length, "warning")} to review`
        : "Ready to publish";

  return (
    <PageBody className="max-w-6xl">
      {checks.error && (
        <Notice tone="error" title="Couldn't run checks">
          {checks.error.message}
        </Notice>
      )}
      <Panel
        title="Checks"
        description={
          summary && (
            <span className="tabular-nums">
              {summary}
              {saveState === "saving" && " · checking…"}
            </span>
          )
        }
        flush
      >
        {!checks.data ? (
          <div className="grid gap-3 p-(--card-p)">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-4 w-2/3 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
            <span className="mb-1 flex size-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 [&_svg]:size-5">
              <CircleCheck />
            </span>
            <p className="m-0 text-sm font-medium">Everything checks out</p>
            <p className="m-0 max-w-sm text-sm text-muted-foreground">
              Questions, coverages, documents and availability all resolve against the risk data.
            </p>
          </div>
        ) : (
          <ul className="m-0 grid list-none divide-y p-0">
            {sorted.map((issue, i) => {
              const { area, where, link } = describeIssue(issue, contents);

              return (
                <li key={i}>
                  <Link
                    to={link.to}
                    params={params}
                    search={link.search}
                    className="group flex items-start gap-3 px-(--card-p) py-3.5 outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/40"
                  >
                    <IssueDot severity={issue.severity} />
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="text-sm">{issue.message}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {[area, ...where].join(" · ")}
                      </span>
                    </span>
                    <ArrowRight
                      aria-hidden
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </PageBody>
  );
}
