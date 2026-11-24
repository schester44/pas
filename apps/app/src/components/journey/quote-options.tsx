import type { AppOutputs } from "@pas/api-client";
import { Button } from "@pas/ui/components/button";
import { Notice } from "@pas/ui/components/notice";
import { Panel } from "@pas/ui/components/panel";
import { Spinner } from "@pas/ui/components/spinner";
import { StatusChip } from "@pas/ui/components/status-chip";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type * as React from "react";
import { formatMoney } from "@/lib/format";
import { submissionTitle } from "@/lib/submissions";
import { useTRPC } from "@/lib/trpc";
import { SubmissionHeading } from "@/components/submission-heading";

type Submission = AppOutputs["submissions"]["get"];
type Option = Submission["options"][number];

const OUTCOME = {
  quoted: { label: "Quoted", tone: "accent" },
  referred: { label: "Needs review", tone: "warning" },
  declined: { label: "Not eligible", tone: "danger" },
} as const;

const RANK = { quoted: 0, referred: 1, declined: 2 } as const;

const byOutcomeThenPrice = (a: Option, b: Option) =>
  RANK[a.outcome] - RANK[b.outcome] ||
  (a.outcome === "quoted" ? Number(a.total.amount) - Number(b.total.amount) : 0);

/** Several products in the offering can write this risk; the agent picks one (PLAN §6.0). */
export function QuoteOptions({ submission }: { submission: Submission }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const options = submission.options.toSorted(byOutcomeThenPrice);
  const open = options.filter((o) => o.outcome !== "declined");
  const declined = options.filter((o) => o.outcome === "declined");

  const choose = useMutation(
    trpc.submissions.chooseOption.mutationOptions({
      onSuccess: async () => {
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: trpc.submissions.get.queryKey({ id: submission.id }),
          }),
          queryClient.invalidateQueries({
            queryKey: trpc.quotes.get.queryKey({ submissionId: submission.id }),
          }),
          queryClient.invalidateQueries({ queryKey: trpc.submissions.list.queryKey() }),
        ]);
      },
    }),
  );

  return (
    <>
      <SubmissionHeading submission={{ ...submission, title: submissionTitle(submission) }} />
      <Panel
        flush
        title="Choose a quote"
        description={`${open.length} of ${options.length} products can write this risk.`}
      >
        <ul className="m-0 list-none divide-y p-0">
          {open.map((option) => (
            <OptionRow key={option.productReleaseId} option={option}>
              <Button
                size="sm"
                variant={option.outcome === "quoted" ? "default" : "outline"}
                disabled={choose.isPending}
                onClick={() =>
                  choose.mutate({
                    submissionId: submission.id,
                    productReleaseId: option.productReleaseId,
                  })
                }
              >
                {choose.isPending &&
                  choose.variables?.productReleaseId === option.productReleaseId && <Spinner />}
                Choose
              </Button>
            </OptionRow>
          ))}
        </ul>
      </Panel>
      {choose.error && (
        <Notice tone="error" title="Couldn't choose that quote">
          {choose.error.message}
        </Notice>
      )}
      {declined.length > 0 && (
        <Panel flush title="Not eligible">
          <ul className="m-0 list-none divide-y p-0">
            {declined.map((option) => (
              <OptionRow key={option.productReleaseId} option={option} />
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}

function OptionRow({ option, children }: { option: Option; children?: React.ReactNode }) {
  const outcome = OUTCOME[option.outcome];

  return (
    <li className="flex items-start gap-4 px-(--card-p) py-4">
      <div className="grid min-w-0 flex-1 gap-1">
        <span className="text-sm leading-5 font-medium">{option.productName}</span>
        {option.reasons.length > 0 && (
          <ul className="m-0 grid list-none gap-0.5 p-0 text-xs text-muted-foreground">
            {option.reasons.map((reason) => (
              <li key={reason.code}>{reason.message}</li>
            ))}
          </ul>
        )}
      </div>
      <StatusChip tone={outcome.tone}>{outcome.label}</StatusChip>
      {option.outcome !== "declined" && (
        <span className="w-28 text-right text-sm font-semibold tabular-nums">
          {formatMoney(option.total, { cents: true })}
        </span>
      )}
      {children}
    </li>
  );
}
