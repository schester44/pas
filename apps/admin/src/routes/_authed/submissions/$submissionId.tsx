import type { AdminOutputs } from "@pas/api-client";
import { Notice } from "@pas/ui/components/notice";
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import { jurisdictionName } from "@pas/ui/lib/jurisdictions";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import type * as React from "react";
import { Breadcrumb } from "@/components/catalog/breadcrumb";
import { CapturedData } from "@/components/submissions/captured-data";
import { SubmissionStatus } from "@/components/submissions/submission-status";
import { formatDate, formatPlainDate } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/submissions/$submissionId")({
  component: SubmissionPage,
});

type Submission = AdminOutputs["submissions"]["get"];

const CHANNEL: Record<string, string> = {
  agent: "Agent",
  customer: "Customer",
  internal: "Internal",
};

const STAGE: Record<string, string> = { quote: "Quote", bind: "Bind", endorsement: "Endorsement" };

function SubmissionPage() {
  const { submissionId } = Route.useParams();
  const trpc = useTRPC();
  const submission = useQuery(trpc.submissions.get.queryOptions({ id: submissionId }));

  const title = (
    <Breadcrumb
      parents={[
        <Link key="submissions" to="/submissions">
          Submissions
        </Link>,
      ]}
      current={submission.data && <span className="tabular-nums">{submission.data.number}</span>}
    />
  );

  return (
    <>
      <PageHeader
        title={title}
        actions={submission.data && <SubmissionStatus status={submission.data.status} />}
      />
      <PageBody className="max-w-6xl">
        {submission.error ? (
          <Notice tone="error" title="Couldn't load this submission">
            {submission.error.message}
          </Notice>
        ) : !submission.data ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="h-96 animate-pulse rounded-xl bg-muted/60" />
            <div className="h-72 animate-pulse rounded-xl bg-muted/60" />
          </div>
        ) : (
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="grid gap-6">
              <CapturedData
                schema={submission.data.riskSchema}
                form={submission.data.form}
                data={submission.data.riskData}
              />
            </div>
            <Summary submission={submission.data} />
          </div>
        )}
      </PageBody>
    </>
  );
}

function Summary({ submission }: { submission: Submission }) {
  return (
    <Panel title="Details" className="lg:sticky lg:top-20">
      <dl className="m-0 grid gap-4">
        <Fact label="Insured">
          {submission.insuredName ?? (
            <span className="text-muted-foreground">Not captured yet</span>
          )}
        </Fact>
        <Fact label="Product">
          <Link
            to="/products/$productId/versions/$versionId"
            params={{ productId: submission.productId, versionId: submission.productVersionId }}
            className="font-medium text-primary outline-none hover:underline focus-visible:underline"
          >
            {submission.productName} {submission.productVersion}
          </Link>
          <span className="block font-mono text-xs break-all text-muted-foreground">
            Release {submission.productReleaseId}
          </span>
        </Fact>
        <Fact label="State">{jurisdictionName(submission.jurisdiction)}</Fact>
        <Fact label="Effective date">
          <span className="tabular-nums">{formatPlainDate(submission.effectiveDate)}</span>
        </Fact>
        <Fact label="Channel">
          {CHANNEL[submission.channel] ?? submission.channel} ·{" "}
          {STAGE[submission.stage] ?? submission.stage}
        </Fact>
        <Fact label="Producer">{submission.producer.name}</Fact>
        <Fact label="Started">
          <span className="tabular-nums">{formatDate(submission.createdAt)}</span>
        </Fact>
        {submission.submittedAt && (
          <Fact label="Submitted">
            <span className="tabular-nums">{formatDate(submission.submittedAt)}</span>
          </Fact>
        )}
      </dl>
    </Panel>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="m-0 text-sm">{children}</dd>
    </div>
  );
}
