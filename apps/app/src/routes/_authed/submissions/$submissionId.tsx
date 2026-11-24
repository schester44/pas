import type { AppOutputs } from "@pas/api-client";
import { type FormData, type FormExtensions, IntakeForm } from "@pas/forms-react";
import { ExtensionSurfaces } from "@pas/ui/components/extension-surfaces";
import { Notice } from "@pas/ui/components/notice";
import { cn } from "@pas/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { DuplicateRiskNotice } from "@/components/duplicate-risk";
import { Journey } from "@/components/journey/journey";
import { QuoteOptions } from "@/components/journey/quote-options";
import { BackLink, SubmissionHeading as Heading } from "@/components/submission-heading";
import { isStep, type StepId } from "@/lib/quotes";
import { submissionTitle } from "@/lib/submissions";
import { trpcClient, useTRPC } from "@/lib/trpc";
import { type SaveState, useAutosave } from "@/lib/use-autosave";
import { useRecordView } from "@/lib/recent-views";

export const Route = createFileRoute("/_authed/submissions/$submissionId")({
  validateSearch: (search: Record<string, unknown>): { step?: StepId } =>
    isStep(search.step) ? { step: search.step } : {},
  component: SubmissionPage,
});

type Submission = AppOutputs["submissions"]["get"];

const INTAKE_COPY = { submit: "Get quote" };

const FLOW = "mx-auto grid w-full max-w-3xl gap-6";

function SubmissionPage() {
  const { submissionId } = Route.useParams();
  useRecordView("submission", submissionId);
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

  if (submission.data.status !== "draft") {
    return <JourneyPage submission={submission.data} />;
  }

  return <Intake key={submission.data.id} submission={submission.data} />;
}

function JourneyPage({ submission }: { submission: Submission }) {
  const { step } = Route.useSearch();

  return (
    <div className="grid w-full gap-6">
      <DuplicateRiskNotice submissionId={submission.id} />
      {submission.awaitingChoice ? (
        <QuoteOptions submission={submission} />
      ) : (
        <Journey submission={submission} step={step} />
      )}
    </div>
  );
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

        void queryClient.invalidateQueries({
          queryKey: trpc.quotes.get.queryKey({ submissionId: submission.id }),
        });

        queryClient.setQueryData(getKey, {
          ...submission,
          ...result.submission,
          riskData: input.riskData,
        });

        if (!result.quote) void queryClient.invalidateQueries({ queryKey: getKey });

        void queryClient.invalidateQueries({ queryKey: trpc.submissions.list.queryKey() });
      },
    }),
  );

  const { options, prefill } = submission.extensionFields;

  const extensions = useMemo<FormExtensions | undefined>(
    () =>
      options.length + prefill.length === 0
        ? undefined
        : {
            optionFields: options,
            prefillFields: prefill,
            loadOptions: (field, values) =>
              trpcClient.submissions.fieldOptions.mutate({
                submissionId: submission.id,
                field,
                values,
              }),
            prefill: (field, values, path) =>
              trpcClient.submissions.fieldPrefill.mutate({
                submissionId: submission.id,
                field,
                path,
                values,
              }),
          },
    [options, prefill, submission.id],
  );

  const loadPanel = useCallback(
    (bindingId: string) =>
      trpcClient.submissions.extensionPanel.query({ submissionId: submission.id, bindingId }),
    [submission.id],
  );

  const runAction = useCallback(
    async (bindingId: string, values: Record<string, unknown>) => {
      await autosave.flush();

      return trpcClient.submissions.extensionAction.mutate({
        submissionId: submission.id,
        bindingId,
        values,
      });
    },
    [autosave, submission.id],
  );

  async function onSubmit(riskData: FormData) {
    autosave.cancel();
    await autosave.flush();
    await submit.mutateAsync({ id: submission.id, riskData }).catch(() => undefined);
  }

  return (
    <div className={FLOW}>
      <Heading
        submission={{ ...submission, title: submissionTitle(submission) }}
        aside={<SaveIndicator state={autosave.state} onRetry={autosave.flush} />}
      />
      <DuplicateRiskNotice submissionId={submission.id} riskData={data} />
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
        copy={INTAKE_COPY}
        serverErrors={serverErrors}
        {...(extensions && { extensions })}
        error={
          submit.error && (
            <Notice tone="error" title="Couldn't submit">
              {submit.error.message}
            </Notice>
          )
        }
      />
      <ExtensionSurfaces
        surfaces={submission.surfaces}
        loadPanel={loadPanel}
        runAction={runAction}
        canAct
        onActionDone={async (outcome) => {
          if (!outcome.applied?.length) return;

          const fresh = await queryClient.fetchQuery({
            ...trpc.submissions.get.queryOptions({ id: submission.id }),
            staleTime: 0,
          });

          setData(fresh.riskData);
        }}
      />
    </div>
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
