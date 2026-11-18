import type { AdminOutputs } from "@pas/api-client";
import { EmptyState } from "@pas/ui/components/empty-state";
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pas/ui/components/table";
import { jurisdictionShort } from "@pas/ui/lib/jurisdictions";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Inbox } from "lucide-react";
import { SubmissionStatus } from "@/components/submissions/submission-status";
import { formatPlainDate, formatRelative } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/submissions/")({
  component: SubmissionsPage,
});

type Submission = AdminOutputs["submissions"]["list"][number];

function SubmissionsPage() {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const submissions = useQuery(trpc.submissions.list.queryOptions({ limit: 200 }));

  const open = (submission: Submission) =>
    navigate({ to: "/submissions/$submissionId", params: { submissionId: submission.id } });

  return (
    <>
      <PageHeader title="Submissions" />
      <PageBody className="max-w-6xl">
        <Panel flush>
          {submissions.error ? (
            <EmptyState
              icon={<Inbox />}
              title={
                submissions.error.data?.code === "FORBIDDEN"
                  ? "You don't have access to submissions"
                  : "Couldn't load submissions"
              }
              description={
                submissions.error.data?.code === "FORBIDDEN"
                  ? "Ask an admin for a role that can view submissions."
                  : "Refresh the page to try again."
              }
            />
          ) : submissions.data?.length === 0 ? (
            <EmptyState
              icon={<Inbox />}
              title="No submissions yet"
              description="Quotes started by agents in the app show up here."
            />
          ) : (
            <>
              <Table className="hidden lg:table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Number</TableHead>
                    <TableHead>Insured</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Effective</TableHead>
                    <TableHead>Producer</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {submissions.isPending &&
                    Array.from({ length: 4 }, (_, i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={8}>
                          <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
                        </TableCell>
                      </TableRow>
                    ))}
                  {submissions.data?.map((submission) => (
                    <TableRow
                      key={submission.id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => open(submission)}
                    >
                      <TableCell>
                        <Link
                          to="/submissions/$submissionId"
                          params={{ submissionId: submission.id }}
                          className="font-medium tabular-nums outline-none hover:underline focus-visible:underline"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {submission.number}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-48 truncate">
                        {submission.insuredName ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {submission.productName}{" "}
                        <span className="tabular-nums">{submission.productVersion}</span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {jurisdictionShort(submission.jurisdiction)}
                      </TableCell>
                      <TableCell className="text-muted-foreground tabular-nums">
                        {formatPlainDate(submission.effectiveDate)}
                      </TableCell>
                      <TableCell className="max-w-40 truncate text-muted-foreground">
                        {submission.producer.name}
                      </TableCell>
                      <TableCell>
                        <SubmissionStatus status={submission.status} quote={submission.quote} />
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground tabular-nums">
                        {formatRelative(submission.updatedAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <ul className="m-0 list-none divide-y p-0 lg:hidden">
                {submissions.data?.map((submission) => (
                  <li key={submission.id}>
                    <Link
                      to="/submissions/$submissionId"
                      params={{ submissionId: submission.id }}
                      className="grid gap-1 px-(--card-p) py-3.5 outline-none hover:bg-muted/40 focus-visible:bg-muted/40"
                    >
                      <span className="flex items-center justify-between gap-3">
                        <span className="truncate text-sm leading-5 font-medium">
                          {submission.insuredName ?? submission.number}
                        </span>
                        <SubmissionStatus status={submission.status} quote={submission.quote} />
                      </span>
                      <span className="truncate text-xs text-muted-foreground tabular-nums">
                        {submission.number} · {submission.productName} ·{" "}
                        {jurisdictionShort(submission.jurisdiction)} ·{" "}
                        {formatPlainDate(submission.effectiveDate)} · {submission.producer.name}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      </PageBody>
    </>
  );
}
