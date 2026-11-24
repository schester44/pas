import type { AppOutputs } from "@pas/api-client";
import { EmptyState } from "@pas/ui/components/empty-state";
import { StatusChip } from "@pas/ui/components/status-chip";
import { jurisdictionName } from "@pas/ui/lib/jurisdictions";
import { FileText } from "lucide-react";
import { formatMoney, formatPlainDate, formatRelative } from "@/lib/format";
import { submissionStatus, submissionTitle } from "@/lib/submissions";
import { DashboardRows, RowLink } from "./rows";

type Submission = AppOutputs["submissions"]["list"][number];

export function SubmissionsList({
  submissions,
  error,
}: {
  submissions: Submission[] | undefined;
  error: { data?: { code?: string } | null } | null;
}) {
  if (error) {
    const forbidden = error.data?.code === "FORBIDDEN";

    return (
      <EmptyState
        icon={<FileText />}
        title={forbidden ? "You can't quote here yet" : "Couldn't load your submissions"}
        description={
          forbidden
            ? "Ask your administrator for access to start quotes."
            : "Refresh the page to try again."
        }
      />
    );
  }

  if (submissions?.length === 0) {
    return (
      <EmptyState
        icon={<FileText />}
        title="No submissions yet"
        description="Quotes you start show up here."
      />
    );
  }

  return (
    <DashboardRows pending={!submissions}>
      {submissions?.map((submission) => {
        const status = submissionStatus(
          submission.status,
          submission.quote,
          submission.awaitingChoice,
        );

        return (
          <li key={submission.id}>
            <RowLink to={{ kind: "submission", id: submission.id }}>
              <div className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate text-sm leading-5 font-medium">
                  {submission.insuredName ?? (
                    <span className="text-muted-foreground">No insured yet</span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums sm:truncate">
                  {submission.quote?.policyNumber ?? submission.number} ·{" "}
                  {submissionTitle(submission)} · {jurisdictionName(submission.jurisdiction)} ·
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
            </RowLink>
          </li>
        );
      })}
    </DashboardRows>
  );
}
