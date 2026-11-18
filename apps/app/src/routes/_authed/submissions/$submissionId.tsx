import type { AppOutputs } from "@pas/api-client";
import { type FormData, IntakeForm } from "@pas/forms-react";
import { Button } from "@pas/ui/components/button";
import { Card } from "@pas/ui/components/card";
import { IconTile } from "@pas/ui/components/icon-tile";
import { Notice } from "@pas/ui/components/notice";
import { jurisdictionName } from "@pas/ui/lib/jurisdictions";
import { cn } from "@pas/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Check } from "lucide-react";
import { useState } from "react";
import { formatPlainDate } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";
import { type SaveState, useAutosave } from "@/lib/use-autosave";

export const Route = createFileRoute("/_authed/submissions/$submissionId")({
  component: SubmissionPage,
});

type Submission = AppOutputs["submissions"]["get"];

const FLOW = "mx-auto grid w-full max-w-3xl gap-6";

function SubmissionPage() {
  const { submissionId } = Route.useParams();
  const trpc = useTRPC();
  const submission = useQuery(trpc.submissions.get.queryOptions({ id: submissionId }));

  if (submission.error) {
    const missing = submission.error.data?.code === "NOT_FOUND";

    return (
      <div className={FLOW}>
        <BackLink />
        <Notice
          tone="error"
          title={missing ? "We couldn't find that quote" : "Couldn't load this quote"}
        >
          {missing
            ? "Check the link, or start a new quote from home."
            : "Refresh the page to try again."}
        </Notice>
      </div>
    );
  }

  if (!submission.data) return <IntakeSkeleton />;

  return <Intake key={submission.data.id} submission={submission.data} />;
}

function Intake({ submission }: { submission: Submission }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [data, setData] = useState<FormData>(submission.riskData);
  const [serverErrors, setServerErrors] = useState<Record<string, string[]>>();
  const getKey = trpc.submissions.get.queryKey({ id: submission.id });
  const saveDraft = useMutation(trpc.submissions.saveDraft.mutationOptions());

  const autosave = useAutosave((riskData: FormData) =>
    saveDraft.mutateAsync({ id: submission.id, riskData }),
  );

  const submit = useMutation(
    trpc.submissions.submit.mutationOptions({
      onSuccess: (result, input) => {
        if (!result.ok) {
          setServerErrors(result.errors);

          return;
        }

        queryClient.setQueryData(getKey, {
          ...submission,
          ...result.submission,
          riskData: input.riskData,
        });

        void queryClient.invalidateQueries({ queryKey: trpc.submissions.list.queryKey() });
      },
    }),
  );

  async function onSubmit(riskData: FormData) {
    autosave.cancel();
    await autosave.flush();
    await submit.mutateAsync({ id: submission.id, riskData }).catch(() => undefined);
  }

  if (submission.status !== "draft") return <Submitted submission={submission} />;

  return (
    <div className={FLOW}>
      <Heading
        submission={submission}
        aside={<SaveIndicator state={autosave.state} onRetry={autosave.flush} />}
      />
      <IntakeForm
        schema={submission.riskSchema}
        form={submission.form}
        value={data}
        onChange={(next) => {
          setData(next);
          autosave.schedule(next);
        }}
        onSubmit={onSubmit}
        busy={submit.isPending}
        serverErrors={serverErrors}
        error={
          submit.error && (
            <Notice tone="error" title="Couldn't submit">
              {submit.error.message}
            </Notice>
          )
        }
      />
    </div>
  );
}

function Submitted({ submission }: { submission: Submission }) {
  return (
    <div className={FLOW}>
      <Heading submission={submission} />
      <Card className="items-center gap-2 px-6 py-14 text-center">
        <IconTile className="mb-2">
          <Check />
        </IconTile>
        <h2 className="m-0 text-xl leading-7 font-semibold tracking-tight tabular-nums">
          {submission.status === "submitted"
            ? `Submitted ${submission.number}`
            : `${submission.number} was withdrawn`}
        </h2>
        <p className="m-0 max-w-sm text-sm text-muted-foreground">
          {submission.status === "submitted"
            ? "Underwriting comes next."
            : "It's no longer being worked on."}
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button variant="outline" asChild>
            <Link to="/">Back to home</Link>
          </Button>
          <Button asChild>
            <Link to="/submissions/new">Start another quote</Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}

function Heading({ submission, aside }: { submission: Submission; aside?: React.ReactNode }) {
  return (
    <div className="grid gap-3">
      <BackLink />
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="grid min-w-0 gap-1">
          <h1 className="m-0 text-2xl leading-tight font-semibold tracking-tight">
            {submission.productName}
          </h1>
          <p className="m-0 text-sm text-muted-foreground tabular-nums">
            {submission.number} · {jurisdictionName(submission.jurisdiction)} · Effective{" "}
            {formatPlainDate(submission.effectiveDate)}
          </p>
        </div>
        {aside}
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/"
      className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:text-foreground"
    >
      <ArrowLeft aria-hidden className="size-4" /> Home
    </Link>
  );
}

const SAVE_LABEL: Record<SaveState, string> = {
  idle: "",
  pending: "Saving…",
  saving: "Saving…",
  saved: "Saved",
  error: "Couldn't save",
};

function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  if (state === "idle") return null;

  return (
    <p
      role="status"
      className={cn(
        "m-0 flex items-center gap-2 text-xs",
        state === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {state === "saved" && <Check aria-hidden className="size-3.5" />}
      {SAVE_LABEL[state]}
      {state === "error" && (
        <button
          type="button"
          onClick={onRetry}
          className="font-medium underline-offset-4 hover:underline"
        >
          Try again
        </button>
      )}
    </p>
  );
}

function IntakeSkeleton() {
  return (
    <div className={FLOW} aria-busy>
      <div className="grid gap-3">
        <div className="h-5 w-16 animate-pulse rounded bg-muted" />
        <div className="h-7 w-56 animate-pulse rounded bg-muted" />
        <div className="h-4 w-80 animate-pulse rounded bg-muted/70" />
      </div>
      <div className="h-8 w-full animate-pulse rounded-md bg-muted/60" />
      <div className="h-80 animate-pulse rounded-xl bg-muted/60" />
    </div>
  );
}
