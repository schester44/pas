import { Button } from "@pas/ui/components/button";
import { EmptyState } from "@pas/ui/components/empty-state";
import { Panel } from "@pas/ui/components/panel";
import { StatusChip } from "@pas/ui/components/status-chip";
import { jurisdictionName } from "@pas/ui/lib/jurisdictions";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, FileText, Plus } from "lucide-react";
import { formatMoney, formatPlainDate, formatRelative } from "@/lib/format";
import { submissionStatus } from "@/lib/submissions";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/")({
  component: HomePage,
});

function HomePage() {
  const trpc = useTRPC();
  const me = useQuery(trpc.me.queryOptions());
  const submissions = useQuery(trpc.submissions.list.queryOptions({ limit: 20 }));
  const firstName = me.data?.user.name.split(" ")[0];

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <h1 className="m-0 text-2xl leading-tight font-semibold tracking-tight">
            {firstName ? `Hi, ${firstName}` : "Welcome"}
          </h1>
          <p className="m-0 text-sm text-muted-foreground">Pick up a draft or start a new quote.</p>
        </div>
        <Button asChild>
          <Link to="/submissions/new">
            <Plus /> Start a quote
          </Link>
        </Button>
      </div>
      <Panel title="Recent quotes" flush>
        {submissions.error ? (
          <EmptyState
            icon={<FileText />}
            title={
              submissions.error.data?.code === "FORBIDDEN"
                ? "You can't quote here yet"
                : "Couldn't load your quotes"
            }
            description={
              submissions.error.data?.code === "FORBIDDEN"
                ? "Ask your administrator for access to start quotes."
                : "Refresh the page to try again."
            }
          />
        ) : submissions.data?.length === 0 ? (
          <EmptyState
            icon={<FileText />}
            title="No quotes yet"
            description="Quotes you start show up here."
          />
        ) : (
          <ul className="m-0 list-none divide-y p-0">
            {submissions.isPending && <SkeletonRows />}
            {submissions.data?.map((submission) => {
              const status = submissionStatus(submission.status, submission.quote);

              return (
                <li key={submission.id}>
                  <Link
                    to="/submissions/$submissionId"
                    params={{ submissionId: submission.id }}
                    className="group flex items-center gap-4 px-(--card-p) py-3.5 outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/40"
                  >
                    <div className="grid min-w-0 flex-1 gap-0.5">
                      <span className="truncate text-sm leading-5 font-medium">
                        {submission.insuredName ?? (
                          <span className="text-muted-foreground">No insured yet</span>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums sm:truncate">
                        {submission.quote?.policyNumber ?? submission.number} ·{" "}
                        {submission.productName} · {jurisdictionName(submission.jurisdiction)} ·
                        Effective {formatPlainDate(submission.effectiveDate)}
                      </span>
                    </div>
                    <span className="hidden w-28 text-right text-sm tabular-nums sm:block">
                      {submission.quote && submission.quote.status !== "declined"
                        ? formatMoney(submission.quote.total, { cents: true })
                        : null}
                    </span>
                    <span className="hidden w-28 text-right text-xs whitespace-nowrap text-muted-foreground tabular-nums md:block">
                      {formatRelative(submission.updatedAt)}
                    </span>
                    <span className="flex w-24 justify-end">
                      <StatusChip tone={status.tone}>{status.label}</StatusChip>
                    </span>
                    <ChevronRight
                      aria-hidden
                      className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </>
  );
}

function SkeletonRows() {
  return Array.from({ length: 3 }, (_, index) => (
    <li key={index} className="grid gap-2 px-(--card-p) py-4">
      <div className="h-4 w-40 animate-pulse rounded bg-muted" />
      <div className="h-3 w-72 animate-pulse rounded bg-muted/70" />
    </li>
  ));
}
