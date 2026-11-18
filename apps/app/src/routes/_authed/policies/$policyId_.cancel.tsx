import { Button } from "@pas/ui/components/button";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { Notice } from "@pas/ui/components/notice";
import { Panel } from "@pas/ui/components/panel";
import { PremiumChange } from "@pas/ui/components/premium-change";
import { RadioGroup, RadioGroupItem } from "@pas/ui/components/radio-group";
import { Spinner } from "@pas/ui/components/spinner";
import { Textarea } from "@pas/ui/components/textarea";
import { jurisdictionName } from "@pas/ui/lib/jurisdictions";
import { noticeExplanation, plainDate } from "@pas/ui/lib/policy-change";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { PolicyBack } from "@/components/policy/policy-back";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/policies/$policyId_/cancel")({
  component: RequestCancellationPage,
});

function RequestCancellationPage() {
  const { policyId } = Route.useParams();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const policy = useQuery(trpc.policies.get.queryOptions({ id: policyId }));
  const reasons = useQuery(trpc.policies.changes.cancellationReasons.queryOptions({ policyId }));
  const authority = useQuery(trpc.policies.changes.authority.queryOptions({ policyId }));
  const [reason, setReason] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");

  const quote = useQuery({
    ...trpc.policies.changes.quoteCancellation.queryOptions({
      policyId,
      reason: reason ?? "",
      ...(date && { effectiveDate: date }),
    }),
    enabled: !!reason,
    placeholderData: keepPreviousData,
    retry: false,
  });

  const request = useMutation(
    trpc.policies.changes.initiateCancellation.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: trpc.policies.pathKey() });
        await navigate({ to: "/policies/$policyId", params: { policyId } });
      },
    }),
  );

  const q = quote.data?.reason === reason ? quote.data : null;
  const chosen = reasons.data?.find((r) => r.code === reason);

  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <PolicyBack policyId={policyId} number={policy.data?.number} />
        <h1 className="m-0 text-2xl leading-tight font-semibold tracking-tight">
          Request cancellation
        </h1>
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid gap-6">
          <Panel title="Reason">
            <RadioGroup
              value={reason ?? ""}
              onValueChange={(value) => {
                setReason(value);
                setDate("");
              }}
              className="gap-0 divide-y rounded-lg border"
            >
              {(reasons.data ?? []).map((r) => (
                <label
                  key={r.code}
                  className="flex cursor-pointer items-center gap-3 px-3 py-3 text-sm font-medium has-[[data-state=checked]]:bg-primary/5"
                >
                  <RadioGroupItem value={r.code} /> {r.label}
                </label>
              ))}
            </RadioGroup>
          </Panel>
          {q && chosen && (
            <Panel title="Effective date">
              <div className="grid gap-4">
                <div className="grid gap-2 sm:max-w-xs">
                  <Label htmlFor="effective">Cancellation takes effect</Label>
                  <Input
                    id="effective"
                    type="date"
                    className="tabular-nums"
                    value={date || q.effectiveDate}
                    min={
                      q.lastChangeDate && q.lastChangeDate > q.earliestDate
                        ? q.lastChangeDate
                        : q.earliestDate
                    }
                    max={q.termEnd}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </div>
                <p className="m-0 rounded-lg bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground tabular-nums">
                    Earliest {plainDate(q.earliestDate)}.
                  </span>{" "}
                  {noticeExplanation({
                    jurisdictionName: jurisdictionName(q.jurisdiction),
                    reasonLabel: chosen.label,
                    initiator: chosen.initiator,
                    minDaysNotice: q.rule.minDaysNotice,
                    mailingDaysAdded: q.rule.mailingDaysAdded,
                    atInception: q.atInception,
                  })}
                </p>
                <div className="grid gap-2">
                  <Label htmlFor="note">
                    Note <span className="font-normal text-muted-foreground">Optional</span>
                  </Label>
                  <Textarea
                    id="note"
                    rows={2}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </div>
              </div>
            </Panel>
          )}
          {quote.error && (
            <Notice tone="error" title="Can't cancel like this">
              {quote.error.message}
            </Notice>
          )}
        </div>
        <Panel
          title="Return premium"
          className="lg:sticky lg:top-6"
          footer={
            q && (
              <div className="grid gap-2">
                {request.error && (
                  <Notice tone="error" title="Couldn't send the request">
                    {request.error.message}
                  </Notice>
                )}
                <Button
                  disabled={request.isPending || quote.isFetching}
                  onClick={() =>
                    request.mutate({
                      policyId,
                      reason: reason!,
                      effectiveDate: q.effectiveDate,
                      ...(note.trim() && { note: note.trim() }),
                    })
                  }
                >
                  {request.isPending && <Spinner />}{" "}
                  {authority.data?.issue ? "Schedule cancellation" : "Submit for approval"}
                </Button>
              </div>
            )
          }
        >
          {q ? (
            <PremiumChange preview={q.preview} />
          ) : (
            <p className="m-0 text-sm text-muted-foreground">
              Choose a reason to see the earliest date and the return premium.
            </p>
          )}
        </Panel>
      </div>
    </div>
  );
}
