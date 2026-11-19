import { Button } from "@pas/ui/components/button";
import { Checkbox } from "@pas/ui/components/checkbox";
import { Label } from "@pas/ui/components/label";
import { Notice } from "@pas/ui/components/notice";
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import { RadioGroup, RadioGroupItem } from "@pas/ui/components/radio-group";
import { Spinner } from "@pas/ui/components/spinner";
import { StatusChip, type StatusTone } from "@pas/ui/components/status-chip";
import { Textarea } from "@pas/ui/components/textarea";
import { cn } from "@pas/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Image } from "lucide-react";
import type * as React from "react";
import { useState } from "react";
import { Breadcrumb } from "@/components/catalog/breadcrumb";
import {
  type Inspection,
  INSPECTION_TYPES,
  InspectionStatus,
  TIMINGS,
} from "@/components/underwriting/labels";
import { formatDateTime } from "@/lib/environment";
import { useAccess } from "@/lib/permissions";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/underwriting/inspections/$inspectionId")({
  component: InspectionPage,
});

const SEVERITY: Record<string, { label: string; tone: StatusTone }> = {
  info: { label: "Note", tone: "neutral" },
  minor: { label: "Minor", tone: "warning" },
  major: { label: "Major", tone: "danger" },
};

const OUTCOMES = [
  { value: "satisfactory", label: "Satisfactory", description: "Nothing more is needed." },
  {
    value: "conditions",
    label: "Add subjectivities",
    description: "Turn the recommendations you pick into post-bind subjectivities.",
  },
  {
    value: "field_inspection",
    label: "Send someone to the property",
    description: "Orders a field inspection to confirm what the report shows.",
  },
] as const;

function InspectionPage() {
  const { inspectionId } = Route.useParams();
  const trpc = useTRPC();
  const access = useAccess();
  const inspection = useQuery(trpc.underwriting.inspections.get.queryOptions({ id: inspectionId }));
  const i = inspection.data;

  return (
    <>
      <PageHeader
        title={
          <Breadcrumb
            parents={[
              <Link key="uw" to="/underwriting" search={{ tab: "inspections" }}>
                Inspections
              </Link>,
            ]}
            current={i && (INSPECTION_TYPES[i.type] ?? i.type)}
          />
        }
        actions={i && <InspectionStatus status={i.status} />}
      />
      <PageBody className="max-w-6xl">
        {inspection.error ? (
          <Notice tone="error" title="Couldn't load this inspection">
            {inspection.error.message}
          </Notice>
        ) : !i ? (
          <div className="h-96 animate-pulse rounded-xl bg-muted/60" />
        ) : (
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="grid gap-6">
              {i.report ? <Report inspection={i} /> : <Waiting inspection={i} />}
              {i.status === "completed" && access.underwriting.approve && <Review inspection={i} />}
              {i.review && (
                <Panel title="Review">
                  <p className="m-0 text-sm">
                    {OUTCOMES.find((o) => o.value === i.review!.outcome)?.label} · {i.review.by},{" "}
                    {formatDateTime(i.review.at)}
                  </p>
                  {i.review.note && (
                    <p className="m-0 mt-1 text-sm text-muted-foreground">{i.review.note}</p>
                  )}
                </Panel>
              )}
              <Panel title="Timeline" flush>
                <ol className="m-0 list-none divide-y p-0">
                  {i.history.toReversed().map((h) => (
                    <li key={h.id} className="flex items-baseline gap-3 px-(--card-p) py-3 text-sm">
                      <span className="flex-1">{h.summary}</span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {formatDateTime(h.at)}
                      </span>
                    </li>
                  ))}
                </ol>
              </Panel>
            </div>
            <Panel title="Details" className="lg:sticky lg:top-20">
              <dl className="m-0 grid gap-4">
                <Fact label="Property">{i.address}</Fact>
                <Fact label="Why">{i.reason}</Fact>
                <Fact label="When">{TIMINGS[i.timing]}</Fact>
                <Fact label="On">
                  {i.policyId ? (
                    <Link
                      to="/policies/$policyId"
                      params={{ policyId: i.policyId }}
                      className="font-medium text-primary tabular-nums hover:underline"
                    >
                      {i.policyNumber}
                    </Link>
                  ) : (
                    <Link
                      to="/submissions/$submissionId"
                      params={{ submissionId: i.submissionId }}
                      className="font-medium text-primary tabular-nums hover:underline"
                    >
                      {i.submissionNumber}
                    </Link>
                  )}
                </Fact>
                <Fact label="Vendor">{i.providerId ?? "Not ordered yet"}</Fact>
                {i.providerRef && (
                  <Fact label="Vendor reference">
                    <span className="font-mono text-xs break-all">{i.providerRef}</span>
                  </Fact>
                )}
              </dl>
            </Panel>
          </div>
        )}
      </PageBody>
    </>
  );
}

function Waiting({ inspection }: { inspection: Inspection }) {
  return (
    <Panel title="Report">
      <p className="m-0 text-sm text-muted-foreground">
        {inspection.status === "scheduled" && inspection.scheduledFor
          ? `Scheduled for ${formatDateTime(inspection.scheduledFor)}. The report comes in once it's done.`
          : "Ordered. The vendor schedules it next."}
      </p>
    </Panel>
  );
}

function Report({ inspection }: { inspection: Inspection }) {
  const report = inspection.report!;

  return (
    <Panel title="Report" description={report.summary} flush>
      {report.imageryOnly && (
        <p className="m-0 flex items-start gap-2.5 border-b px-(--card-p) py-3 text-sm">
          <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500" />
          These findings come from imagery only. They can't be the sole basis for a decline or
          non-renewal; confirm them before acting.
        </p>
      )}
      <ul className="m-0 list-none divide-y p-0">
        {report.findings.map((f) => (
          <li key={f.code} className="flex items-start gap-3 px-(--card-p) py-3">
            <div className="grid min-w-0 flex-1 gap-0.5">
              <span className="text-sm leading-5 font-medium">{f.label}</span>
              <span className="text-xs text-muted-foreground">
                {f.detail} · {f.source === "imagery" ? "Imagery" : "On site"}
              </span>
              {f.recommendation && (
                <span className="text-xs text-muted-foreground">
                  Recommends: {f.recommendation.title} within {f.recommendation.dueDays} days
                </span>
              )}
            </div>
            <StatusChip tone={SEVERITY[f.severity]?.tone ?? "neutral"}>
              {SEVERITY[f.severity]?.label ?? f.severity}
            </StatusChip>
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-3 gap-3 border-t px-(--card-p) py-4">
        {report.photos.map((p) => (
          <figure key={p.caption} className="m-0 grid gap-1.5">
            <div className="flex aspect-[4/3] items-center justify-center rounded-lg bg-muted/60 text-muted-foreground">
              <Image className="size-5" />
            </div>
            <figcaption className="text-xs text-muted-foreground">{p.caption}</figcaption>
          </figure>
        ))}
      </div>
    </Panel>
  );
}

function Review({ inspection }: { inspection: Inspection }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const recommendations = (inspection.report?.findings ?? []).flatMap((f) =>
    f.recommendation ? [f.recommendation] : [],
  );

  const [outcome, setOutcome] = useState<(typeof OUTCOMES)[number]["value"]>(
    recommendations.length > 0 ? "conditions" : "satisfactory",
  );

  const [codes, setCodes] = useState<string[]>(recommendations.map((r) => r.code));
  const [note, setNote] = useState("");

  const review = useMutation(
    trpc.underwriting.inspections.review.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.underwriting.pathKey() }),
    }),
  );

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();

    review.mutate({
      id: inspection.id,
      outcome,
      subjectivityCodes: outcome === "conditions" ? codes : [],
      ...(note.trim() && { note: note.trim() }),
    });
  }

  return (
    <Panel title="Your review">
      <form onSubmit={onSubmit} className="grid gap-5">
        <RadioGroup
          value={outcome}
          onValueChange={(v) => setOutcome(v as typeof outcome)}
          className="grid gap-3"
        >
          {OUTCOMES.map((o) => (
            <label key={o.value} className="flex items-start gap-2.5 text-sm">
              <RadioGroupItem value={o.value} className="mt-0.5" />
              <span className="grid gap-0.5">
                <span className="font-medium">{o.label}</span>
                <span className="text-muted-foreground">{o.description}</span>
              </span>
            </label>
          ))}
        </RadioGroup>
        {outcome === "conditions" && (
          <fieldset
            className={cn(
              "m-0 grid gap-2 rounded-lg bg-muted/40 p-3",
              recommendations.length === 0 && "hidden",
            )}
          >
            <legend className="sr-only">Recommendations</legend>
            {recommendations.map((r) => (
              <label key={r.code} className="flex items-center gap-2.5 text-sm">
                <Checkbox
                  checked={codes.includes(r.code)}
                  onCheckedChange={(checked) =>
                    setCodes((c) => (checked ? [...c, r.code] : c.filter((x) => x !== r.code)))
                  }
                />
                {r.title}{" "}
                <span className="text-muted-foreground tabular-nums">· {r.dueDays} days</span>
              </label>
            ))}
          </fieldset>
        )}
        <div className="grid gap-2">
          <Label htmlFor="review-note">
            Note <span className="font-normal text-muted-foreground">optional</span>
          </Label>
          <Textarea
            id="review-note"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        {review.error && (
          <Notice tone="error" title="Couldn't save the review">
            {review.error.message}
          </Notice>
        )}
        <div className="flex justify-end">
          <Button type="submit" disabled={review.isPending}>
            {review.isPending && <Spinner />}
            Save review
          </Button>
        </div>
      </form>
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
