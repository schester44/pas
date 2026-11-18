import type { AppOutputs } from "@pas/api-client";
import { Button } from "@pas/ui/components/button";
import { type CoverageChoiceLike, CoverageEditor } from "@pas/ui/components/coverage-editor";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { Notice } from "@pas/ui/components/notice";
import { Panel } from "@pas/ui/components/panel";
import { PremiumChange } from "@pas/ui/components/premium-change";
import { Spinner } from "@pas/ui/components/spinner";
import { Textarea } from "@pas/ui/components/textarea";
import { plainDate } from "@pas/ui/lib/policy-change";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { PolicyBack } from "@/components/policy/policy-back";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/policies/$policyId_/endorse")({
  component: RequestChangePage,
});

type Setup = AppOutputs["policies"]["changes"]["endorsementSetup"];

function RequestChangePage() {
  const { policyId } = Route.useParams();
  const trpc = useTRPC();
  const policy = useQuery(trpc.policies.get.queryOptions({ id: policyId }));
  const setup = useQuery(trpc.policies.changes.endorsementSetup.queryOptions({ policyId }));
  const authority = useQuery(trpc.policies.changes.authority.queryOptions({ policyId }));

  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <PolicyBack policyId={policyId} number={policy.data?.number} />
        <h1 className="m-0 text-2xl leading-tight font-semibold tracking-tight">
          Request a change
        </h1>
      </div>
      {setup.error ? (
        <Notice tone="error" title="Couldn't load this policy">
          {setup.error.message}
        </Notice>
      ) : !setup.data || !authority.data ? (
        <div className="h-96 animate-pulse rounded-xl bg-muted/60" />
      ) : (
        <ChangeEditor policyId={policyId} setup={setup.data} canIssue={authority.data.issue} />
      )}
    </div>
  );
}

function ChangeEditor({
  policyId,
  setup,
  canIssue,
}: {
  policyId: string;
  setup: Setup;
  canIssue: boolean;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [effectiveDate, setEffectiveDate] = useState(setup.earliestEffective);
  const [coverages, setCoverages] = useState<CoverageChoiceLike[]>(setup.selection);
  const [note, setNote] = useState("");

  const [preview, setPreview] = useState<Setup["open"]>(
    setup.open?.type === "ENDORSEMENT" ? setup.open : null,
  );

  const [stale, setStale] = useState(false);

  const exposures = Object.fromEntries(
    setup.offers
      .flatMap((o) => (o.attachesTo.level === "exposure" ? [o.attachesTo.path] : []))
      .map((path) => {
        const rows = setup.risk[path];

        return [
          path,
          Array.from({ length: Array.isArray(rows) ? rows.length : 1 }, (_, i) => `${path}[${i}]`),
        ];
      }),
  );

  const quote = useMutation(
    trpc.policies.changes.quoteEndorsement.mutationOptions({
      onSuccess: (result) => {
        setPreview(result);
        setStale(false);
      },
    }),
  );

  const submit = useMutation(
    trpc.policies.changes.issue.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: trpc.policies.pathKey() });
        await navigate({ to: "/policies/$policyId", params: { policyId } });
      },
    }),
  );

  const pending = preview?.status === "pending_approval";

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="grid gap-6">
        <Panel title="When">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="effective">Change takes effect</Label>
              <Input
                id="effective"
                type="date"
                className="tabular-nums"
                value={effectiveDate}
                min={setup.earliestEffective}
                max={setup.termEnd}
                onChange={(e) => {
                  setEffectiveDate(e.target.value);
                  setStale(true);
                }}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="note">
                Note for the underwriter{" "}
                <span className="font-normal text-muted-foreground">Optional</span>
              </Label>
              <Textarea id="note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
        </Panel>
        <Panel title="Coverages" flush>
          <CoverageEditor
            offers={setup.offers}
            exposures={exposures}
            value={coverages}
            original={setup.selection}
            onChange={(value) => {
              setCoverages(value);
              setStale(true);
            }}
          />
        </Panel>
      </div>
      <Panel
        title="Premium change"
        className="lg:sticky lg:top-6"
        footer={
          <div className="grid gap-2">
            {(quote.error ?? submit.error) && (
              <Notice tone="error" title="Couldn't do that">
                {(quote.error ?? submit.error)!.message}
              </Notice>
            )}
            {(!preview || stale) && !pending ? (
              <Button
                disabled={quote.isPending}
                onClick={() =>
                  quote.mutate({
                    policyId,
                    ...(preview && { transactionId: preview.id }),
                    effectiveDate,
                    coverages,
                    ...(note.trim() && { note: note.trim() }),
                  })
                }
              >
                {quote.isPending && <Spinner />} Preview change
              </Button>
            ) : (
              <Button
                disabled={submit.isPending || pending}
                onClick={() => preview && submit.mutate({ policyId, transactionId: preview.id })}
              >
                {submit.isPending && <Spinner />}
                {pending
                  ? "Sent for approval"
                  : canIssue
                    ? "Issue endorsement"
                    : "Submit for approval"}
              </Button>
            )}
          </div>
        }
      >
        {preview ? (
          <PremiumChange preview={preview} />
        ) : (
          <p className="m-0 text-sm text-muted-foreground">
            Change coverages, then preview the prorated premium from {plainDate(effectiveDate)}.
          </p>
        )}
      </Panel>
    </div>
  );
}
