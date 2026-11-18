import type { AdminOutputs } from "@pas/api-client";
import { getAt } from "@pas/forms-core";
import { IntakeForm } from "@pas/forms-react";
import { Button } from "@pas/ui/components/button";
import { type CoverageChoiceLike, CoverageEditor } from "@pas/ui/components/coverage-editor";
import { EmptyState } from "@pas/ui/components/empty-state";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { Notice } from "@pas/ui/components/notice";
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import { PremiumChange } from "@pas/ui/components/premium-change";
import { Spinner } from "@pas/ui/components/spinner";
import { Textarea } from "@pas/ui/components/textarea";
import { plainDate } from "@pas/ui/lib/policy-change";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Breadcrumb } from "@/components/catalog/breadcrumb";
import {
  AddressFields,
  type Address,
  InterestsEditor,
  type Interest,
} from "@/components/policies/party-fields";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/policies/$policyId_/endorse")({
  component: EndorsePage,
});

type Setup = AdminOutputs["policies"]["changes"]["endorsementSetup"];
type Preview = AdminOutputs["policies"]["changes"]["quoteEndorsement"];

function EndorsePage() {
  const { policyId } = Route.useParams();
  const trpc = useTRPC();
  const policy = useQuery(trpc.policies.get.queryOptions({ id: policyId }));
  const setup = useQuery(trpc.policies.changes.endorsementSetup.queryOptions({ policyId }));
  const authority = useQuery(trpc.policies.changes.authority.queryOptions({ policyId }));

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
            current="Change policy"
          />
        }
      />
      <PageBody className="max-w-6xl">
        {setup.error ? (
          <Notice tone="error" title="Couldn't load this policy">
            {setup.error.message}
          </Notice>
        ) : !setup.data || !authority.data ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="h-96 animate-pulse rounded-xl bg-muted/60" />
            <div className="h-64 animate-pulse rounded-xl bg-muted/60" />
          </div>
        ) : (
          <Editor policyId={policyId} setup={setup.data} authority={authority.data} />
        )}
      </PageBody>
    </>
  );
}

function exposuresOf(setup: Setup, risk: Record<string, unknown>) {
  const paths = new Set(
    setup.offers.flatMap((o) => (o.attachesTo.level === "exposure" ? [o.attachesTo.path] : [])),
  );

  return Object.fromEntries(
    [...paths].map((path) => {
      const rows = getAt(risk, path);

      return [
        path,
        Array.from({ length: Array.isArray(rows) ? rows.length : 1 }, (_, i) => `${path}[${i}]`),
      ];
    }),
  );
}

function Editor({
  policyId,
  setup,
  authority,
}: {
  policyId: string;
  setup: Setup;
  authority: { issue: boolean; approveReferrals: boolean };
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const resumable = setup.open?.type === "ENDORSEMENT" ? setup.open : null;

  const [effectiveDate, setEffectiveDate] = useState(
    resumable?.effectiveDate ?? setup.earliestEffective,
  );

  const [risk, setRisk] = useState<Record<string, unknown>>(setup.risk);
  const [coverages, setCoverages] = useState<CoverageChoiceLike[]>(setup.selection);

  const [mailing, setMailing] = useState<Address | null>(
    (setup.parties.mailingAddress as Address | null) ?? null,
  );

  const [interests, setInterests] = useState<Interest[]>(
    setup.parties.additionalInterests as Interest[],
  );

  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<Preview | null>(resumable);
  const [stale, setStale] = useState(false);

  const edit =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setStale(true);
    };

  const done = async () => {
    await queryClient.invalidateQueries({ queryKey: trpc.policies.pathKey() });
    await navigate({ to: "/policies/$policyId", params: { policyId } });
  };

  const quote = useMutation(
    trpc.policies.changes.quoteEndorsement.mutationOptions({
      onSuccess: (result) => {
        setPreview(result);
        setStale(false);
      },
    }),
  );

  const issue = useMutation(trpc.policies.changes.issue.mutationOptions({ onSuccess: done }));
  const discard = useMutation(trpc.policies.changes.discard.mutationOptions({ onSuccess: done }));

  const runPreview = () =>
    quote.mutate({
      policyId,
      ...(preview && { transactionId: preview.id }),
      effectiveDate,
      risk,
      coverages,
      parties: {
        ...(!formEditsMailing && { mailingAddress: mailing }),
        additionalInterests: interests,
      },
      ...(note.trim() && { note: note.trim() }),
    });

  const formEditsMailing = !!setup.form?.steps.some((step) =>
    step.sections.some(
      (section) => !section.repeat && section.items.some((item) => item.path === "mailingAddress"),
    ),
  );

  const blocked = setup.open && setup.open.type !== "ENDORSEMENT";
  const pending = preview?.status === "pending_approval";
  const referred = (preview?.referrals.length ?? 0) > 0;
  const canIssue = authority.issue && (!referred || authority.approveReferrals);

  const issueLabel = canIssue
    ? pending
      ? "Approve and issue"
      : "Issue endorsement"
    : "Submit for approval";

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="grid gap-6">
        {blocked && (
          <Notice title="Another change is open">
            Finish or discard the open {setup.open!.type.toLowerCase().replaceAll("_", " ")} before
            endorsing.
          </Notice>
        )}
        <Panel title="Effective date">
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
                onChange={(e) => edit(setEffectiveDate)(e.target.value)}
              />
              <p className="m-0 text-xs text-muted-foreground tabular-nums">
                Term {plainDate(setup.termStart)} – {plainDate(setup.termEnd)}
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="note">
                Note <span className="font-normal text-muted-foreground">Optional</span>
              </Label>
              <Textarea id="note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
        </Panel>

        <Panel
          title="Coverages"
          description="Limits and deductibles the product offers for this risk."
          flush
        >
          <CoverageEditor
            offers={setup.offers}
            exposures={exposuresOf(setup, risk)}
            value={coverages}
            original={setup.selection}
            onChange={edit(setCoverages)}
          />
        </Panel>

        {!formEditsMailing && (
          <Panel title="Mailing address" description="Changing it doesn't change the premium.">
            <AddressFields value={mailing} onChange={edit(setMailing)} />
          </Panel>
        )}

        <Panel
          title="Additional interests"
          description="Mortgagees, additional insureds and loss payees."
        >
          <InterestsEditor value={interests} onChange={edit(setInterests)} />
        </Panel>

        {setup.form ? (
          <IntakeForm
            schema={setup.schema}
            form={setup.form}
            value={risk}
            onChange={edit(setRisk)}
            onSubmit={runPreview}
            busy={quote.isPending}
            copy={{ submit: "Preview change" }}
            error={
              quote.error && (
                <Notice tone="error" title="Couldn't price this change">
                  {quote.error.message}
                </Notice>
              )
            }
          />
        ) : (
          <div className="grid gap-3">
            {quote.error && (
              <Notice tone="error" title="Couldn't price this change">
                {quote.error.message}
              </Notice>
            )}
            <div className="flex justify-end">
              <Button onClick={runPreview} disabled={quote.isPending || !!blocked}>
                {quote.isPending && <Spinner />} Preview change
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:sticky lg:top-20">
        <Panel
          title="Premium change"
          description={preview ? `Prorated from ${plainDate(preview.effectiveDate)}` : undefined}
          footer={
            preview && (
              <div className="grid gap-2">
                {stale && (
                  <Button variant="outline" disabled={quote.isPending} onClick={runPreview}>
                    {quote.isPending && <Spinner />} Preview again
                  </Button>
                )}
                {issue.error && (
                  <Notice tone="error" title="Couldn't issue">
                    {issue.error.message}
                  </Notice>
                )}
                <Button
                  disabled={stale || issue.isPending || (pending && !canIssue)}
                  onClick={() => issue.mutate({ policyId, transactionId: preview.id })}
                >
                  {issue.isPending && <Spinner />}
                  {pending && !canIssue ? "Waiting for approval" : issueLabel}
                </Button>
                <Button
                  variant="ghost"
                  disabled={discard.isPending}
                  onClick={() => discard.mutate({ policyId, transactionId: preview.id })}
                >
                  Discard change
                </Button>
              </div>
            )
          }
        >
          {!preview ? (
            <EmptyState title="Make a change, then preview it to see the prorated premium." />
          ) : (
            <div className="grid gap-4">
              {stale && (
                <p className="m-0 flex items-center gap-2 text-sm">
                  <span aria-hidden className="size-1.5 rounded-full bg-amber-500" />
                  Edited since this preview. Preview again to issue.
                </p>
              )}
              {referred && (
                <div className="grid gap-1 text-sm">
                  <p className="m-0 flex items-center gap-2 font-medium">
                    <span aria-hidden className="size-1.5 rounded-full bg-amber-500" />
                    Needs underwriting approval
                  </p>
                  {preview.referrals.map((r) => (
                    <p key={r.reasonCode} className="m-0 pl-3.5 text-muted-foreground">
                      {r.message}
                    </p>
                  ))}
                </div>
              )}
              {preview.changes.length > 0 && (
                <ul className="m-0 grid list-none gap-2 rounded-lg bg-muted/50 p-3 text-sm">
                  {preview.changes.map((c) => (
                    <li key={c.path} className="grid gap-0.5">
                      <span className="font-medium">{c.label}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {c.before === null || c.before === undefined
                          ? changeText(c.after)
                          : `${changeText(c.before)} → ${changeText(c.after)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <PremiumChange preview={preview} />
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function changeText(value: unknown): string {
  if (value === null || value === undefined) return "Removed";

  if (typeof value === "string" || typeof value === "number") return String(value);

  if (typeof value === "boolean") return value ? "Yes" : "No";

  if (Array.isArray(value)) return `${value.length} listed`;

  const address = value as Partial<Address>;

  return address.line1 ? `${address.line1}, ${address.city}` : "Updated";
}
