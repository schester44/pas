import type { AdminOutputs } from "@pas/api-client";
import { Button } from "@pas/ui/components/button";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { Notice } from "@pas/ui/components/notice";
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import { PremiumChange } from "@pas/ui/components/premium-change";
import { RadioGroup, RadioGroupItem } from "@pas/ui/components/radio-group";
import { Spinner } from "@pas/ui/components/spinner";
import { Textarea } from "@pas/ui/components/textarea";
import { daysUntil, plainDate, recipientLabel } from "@pas/ui/lib/policy-change";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Breadcrumb } from "@/components/catalog/breadcrumb";
import { NoticeWhy, noticeSentence } from "@/components/policies/notice-why";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/policies/$policyId_/cancel")({
  component: CancelPage,
});

type CancellationQuote = AdminOutputs["policies"]["changes"]["quoteCancellation"];

function CancelPage() {
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

  const initiate = useMutation(
    trpc.policies.changes.initiateCancellation.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: trpc.policies.pathKey() });
        await navigate({ to: "/policies/$policyId", params: { policyId } });
      },
    }),
  );

  const q = quote.data && quote.data.reason === reason ? quote.data : null;
  const chosen = reasons.data?.find((r) => r.code === reason);
  const effective = date || q?.effectiveDate || "";
  const immediate = effective !== "" && daysUntil(effective) <= 0;

  const action = !authority.data?.issue
    ? "Submit for approval"
    : immediate
      ? "Cancel policy today"
      : "Schedule cancellation";

  return (
    <>
      <PageHeader
        title={
          <Breadcrumb
            parents={[
              <Link key="policies" to="/policies">
                Policies
              </Link>,
              <Link
                key="policy"
                to="/policies/$policyId"
                params={{ policyId }}
                className="tabular-nums"
              >
                {policy.data?.number ?? "Policy"}
              </Link>,
            ]}
            current="Cancel policy"
          />
        }
      />
      <PageBody className="max-w-6xl">
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="grid gap-6">
            <Panel title="Reason">
              {!reasons.data ? (
                <div className="h-32 animate-pulse rounded-lg bg-muted/60" />
              ) : (
                <RadioGroup
                  value={reason ?? ""}
                  onValueChange={(value) => {
                    setReason(value);
                    setDate("");
                  }}
                  className="gap-0 divide-y rounded-lg border"
                >
                  {reasons.data.map((r) => (
                    <label
                      key={r.code}
                      className="flex cursor-pointer items-start gap-3 px-3 py-3 has-[[data-state=checked]]:bg-primary/5"
                    >
                      <RadioGroupItem value={r.code} className="mt-0.5" />
                      <span className="grid gap-0.5">
                        <span className="text-sm font-medium">{r.label}</span>
                        <span className="text-xs text-muted-foreground">
                          {r.initiator === "insured"
                            ? "Requested by the insured"
                            : "Initiated by the company"}
                        </span>
                      </span>
                    </label>
                  ))}
                </RadioGroup>
              )}
            </Panel>

            {reason && (
              <Panel title="Effective date">
                <div className="grid gap-4">
                  {quote.error && !q ? (
                    <Notice tone="error" title="Can't cancel for this reason">
                      {quote.error.message}
                    </Notice>
                  ) : !q ? (
                    <div className="h-16 animate-pulse rounded-lg bg-muted/60" />
                  ) : (
                    <>
                      <div className="grid gap-2 sm:max-w-xs">
                        <Label htmlFor="effective">Cancellation takes effect</Label>
                        <Input
                          id="effective"
                          type="date"
                          className="tabular-nums"
                          value={effective}
                          min={
                            q.lastChangeDate && q.lastChangeDate > q.earliestDate
                              ? q.lastChangeDate
                              : q.earliestDate
                          }
                          max={q.termEnd}
                          onChange={(e) => setDate(e.target.value)}
                        />
                      </div>
                      <div className="grid gap-1 rounded-lg bg-muted/50 px-3 py-2.5 text-sm">
                        <p className="m-0">
                          Earliest valid date{" "}
                          <span className="font-medium tabular-nums">
                            {plainDate(q.earliestDate)}
                          </span>
                        </p>
                        <p className="m-0 text-muted-foreground">
                          {noticeSentence(basisOf(q, chosen))}{" "}
                          <NoticeWhy basis={basisOf(q, chosen)} />
                        </p>
                        {q.lastChangeDate && q.lastChangeDate > q.earliestDate && (
                          <p className="m-0 text-muted-foreground">
                            The policy has a change effective {plainDate(q.lastChangeDate)}, so the
                            cancellation can't be earlier.
                          </p>
                        )}
                      </div>
                      {quote.error && (
                        <Notice tone="error" title="Pick another date">
                          {quote.error.message}
                        </Notice>
                      )}
                    </>
                  )}
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
          </div>

          <div className="lg:sticky lg:top-20">
            <Panel
              title="Return premium"
              description={
                q
                  ? `${q.preview.cancellation?.method === "pro_rata" ? "Pro rata" : "Prorated"} from ${plainDate(q.effectiveDate)}`
                  : undefined
              }
              footer={
                q && (
                  <div className="grid gap-2">
                    {initiate.error && (
                      <Notice tone="error" title="Couldn't cancel">
                        {initiate.error.message}
                      </Notice>
                    )}
                    <Button
                      variant={authority.data?.issue ? "destructive" : "default"}
                      disabled={initiate.isPending || !!quote.error || quote.isFetching}
                      onClick={() =>
                        initiate.mutate({
                          policyId,
                          reason: reason!,
                          effectiveDate: q.effectiveDate,
                          ...(note.trim() && { note: note.trim() }),
                        })
                      }
                    >
                      {initiate.isPending && <Spinner />} {action}
                    </Button>
                    <p className="m-0 text-xs text-muted-foreground">
                      {!q.rule
                        ? authority.data?.issue
                          ? "No notice goes out."
                          : "Someone who can issue reviews it first."
                        : authority.data?.issue
                          ? `Sends the notice to the ${new Intl.ListFormat("en-US").format(q.rule.recipients.map(recipientLabel))} today.`
                          : "Someone who can issue reviews it before the notice goes out."}
                    </p>
                  </div>
                )
              }
            >
              {!reason ? (
                <p className="m-0 text-sm text-muted-foreground">
                  Choose a reason to see the earliest date and the return premium.
                </p>
              ) : !q ? (
                <div className="h-40 animate-pulse rounded-lg bg-muted/60" />
              ) : (
                <PremiumChange preview={q.preview} />
              )}
            </Panel>
          </div>
        </div>
      </PageBody>
    </>
  );
}

function basisOf(q: CancellationQuote, reason: { label: string; initiator: string } | undefined) {
  return {
    jurisdiction: q.jurisdiction,
    reasonLabel: reason?.label ?? q.reason,
    initiator: reason?.initiator ?? "company",
    noticeDate: q.preview.cancellation?.noticeDate ?? q.earliestDate,
    earliestDate: q.earliestDate,
    atInception: q.atInception,
    rule: q.rule,
  };
}
