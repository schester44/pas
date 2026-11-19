import { Button } from "@pas/ui/components/button";
import { Checkbox } from "@pas/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@pas/ui/components/dialog";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { Notice } from "@pas/ui/components/notice";
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pas/ui/components/select";
import { Spinner } from "@pas/ui/components/spinner";
import { Textarea } from "@pas/ui/components/textarea";
import { jurisdictionName } from "@pas/ui/lib/jurisdictions";
import { cn } from "@pas/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus, X } from "lucide-react";
import type * as React from "react";
import { useState } from "react";
import { Breadcrumb } from "@/components/catalog/breadcrumb";
import { CapturedData } from "@/components/submissions/captured-data";
import {
  QuotePremium,
  QuoteWorksheet,
  Reasons,
  type StaffQuote,
  WhySheet,
} from "@/components/submissions/quote";
import {
  blankSubjectivity,
  type DraftSubjectivity,
  InspectionsPanel,
  SubjectivitiesPanel,
  SubjectivityFields,
} from "@/components/underwriting/conditions";
import { type ReferralDetail, ReferralStatus } from "@/components/underwriting/labels";
import { useEnvironment } from "@/lib/environment";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { useAccess } from "@/lib/permissions";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/underwriting/referrals/$referralId")({
  component: ReferralPage,
});

type Referral = ReferralDetail["referral"];
type Amount = StaffQuote["coverages"][number]["limits"][number];

const amountKey = (a: Amount | null) => (!a ? "" : a.kind === "money" ? a.amount : `${a.value}%`);

const amountLabel = (a: Amount) => (a.kind === "money" ? formatMoney(a) : `${a.value}%`);

const IN_QUEUE = ["open", "escalated", "info_requested"];

function ReferralPage() {
  const { referralId } = Route.useParams();
  const trpc = useTRPC();
  const access = useAccess();
  const detail = useQuery(trpc.underwriting.referral.queryOptions({ id: referralId }));
  const submissionId = detail.data?.referral.submissionId;

  const submission = useQuery({
    ...trpc.submissions.get.queryOptions({ id: submissionId ?? "" }),
    enabled: !!submissionId,
  });

  const quote = useQuery({
    ...trpc.submissions.quote.queryOptions({ submissionId: submissionId ?? "" }),
    enabled: !!submissionId,
  });

  const referral = detail.data?.referral;

  return (
    <>
      <PageHeader
        title={
          <Breadcrumb
            parents={[
              <Link key="uw" to="/underwriting">
                Underwriting
              </Link>,
            ]}
            current={referral && <span className="tabular-nums">{referral.submissionNumber}</span>}
          />
        }
        actions={referral && <ReferralStatus status={referral.status} />}
      />
      <PageBody className="max-w-6xl">
        {detail.error ? (
          <Notice tone="error" title="Couldn't load this referral">
            {detail.error.message}
          </Notice>
        ) : !referral || !detail.data ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="h-96 animate-pulse rounded-xl bg-muted/60" />
            <div className="h-72 animate-pulse rounded-xl bg-muted/60" />
          </div>
        ) : (
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="grid gap-6">
              <Decision
                detail={detail.data}
                quote={quote.data ?? null}
                schema={submission.data?.riskSchema}
                canDecide={access.underwriting.approve}
              />
              <Conversation referral={referral} />
              {quote.data && quote.data.status !== "declined" && (
                <QuotePremium quote={quote.data} />
              )}
              <AtThisAddress submissionId={referral.submissionId} />
              <SubjectivitiesPanel
                quoteId={referral.quoteId}
                submissionId={referral.submissionId}
                canDecide={access.underwriting.approve}
              />
              <InspectionsPanel quoteId={referral.quoteId} />
              {quote.data && submission.data && (
                <QuoteWorksheet quote={quote.data} schema={submission.data.riskSchema} />
              )}
              {submission.data && (
                <div className="grid gap-2">
                  <CapturedData
                    schema={submission.data.riskSchema}
                    form={submission.data.form}
                    data={submission.data.riskData}
                  />
                  <p className="m-0 px-1 text-xs text-muted-foreground">
                    Every value was entered by the producer. This release has no enrichment plan, so
                    no field came from a data provider.
                  </p>
                </div>
              )}
            </div>
            <Facts detail={detail.data} canDecide={access.underwriting.approve} />
          </div>
        )}
      </PageBody>
    </>
  );
}

function Decision({
  detail,
  quote,
  schema,
  canDecide,
}: {
  detail: ReferralDetail;
  quote: StaffQuote | null;
  schema: Parameters<typeof WhySheet>[0]["schema"] | undefined;
  canDecide: boolean;
}) {
  const [why, setWhy] = useState(false);
  const [dialog, setDialog] = useState<"approve" | "decline" | "info" | null>(null);
  const r = detail.referral;
  const open = IN_QUEUE.includes(r.status);
  const canApprove = !!detail.me.profile && detail.me.profile.level >= 1;

  return (
    <Panel
      title={open ? "Referred to underwriting" : "Referral"}
      description={
        r.decision
          ? `${r.decision.outcome === "approved" ? "Approved" : "Declined"} by ${r.decision.by} on ${formatDate(r.decision.at)}.`
          : `Referred ${formatDateTime(r.openedAt)}. Review by ${formatDateTime(r.dueAt)}.`
      }
      action={
        quote &&
        schema && (
          <Button variant="ghost" size="sm" onClick={() => setWhy(true)}>
            Why referred?
          </Button>
        )
      }
      footer={
        open &&
        canDecide && (
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={r.status === "info_requested"}
              onClick={() => setDialog("info")}
            >
              Request info
            </Button>
            <Button variant="outline" onClick={() => setDialog("decline")}>
              Decline
            </Button>
            <Button disabled={!canApprove} onClick={() => setDialog("approve")}>
              Approve
            </Button>
          </div>
        )
      }
    >
      <div className="grid gap-4">
        {r.escalation && open && (
          <p className="m-0 flex items-start gap-2.5 text-sm">
            <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-red-500" />
            <span>
              Escalated by {r.escalation.by} to {r.requiredAuthority ?? `level ${r.requiredLevel}`}:{" "}
              <span className="text-muted-foreground">{r.escalation.problems.join("; ")}</span>
            </span>
          </p>
        )}
        <Reasons reasons={r.reasons} />
        {r.decision && <DecisionSummary decision={r.decision} />}
      </div>
      {quote && schema && (
        <WhySheet quote={quote} schema={schema} open={why} onOpenChange={setWhy} />
      )}
      <RequestInfoDialog
        referralId={r.id}
        open={dialog === "info"}
        onClose={() => setDialog(null)}
      />
      <DeclineDialog
        referralId={r.id}
        open={dialog === "decline"}
        onClose={() => setDialog(null)}
      />
      {quote && (
        <ApproveDialog
          referral={r}
          me={detail.me}
          quote={quote}
          open={dialog === "approve"}
          onClose={() => setDialog(null)}
        />
      )}
    </Panel>
  );
}

function DecisionSummary({ decision }: { decision: NonNullable<Referral["decision"]> }) {
  const changes = decision.changes as {
    terms?: {
      coverages: { coverage: string; exposure?: string; deductible?: Amount; limit?: Amount }[];
      adjustment: { percent: string; reason: string } | null;
    };
    conditions?: string[];
    subjectivities?: string[];
    reasonCodes?: string[];
    adverseActionNotice?: string | null;
    writtenPremium?: { amount: string; currency: string };
  };

  const lines = [
    ...(changes.terms?.coverages ?? []).map(
      (c) =>
        `${c.coverage.replaceAll("_", " ")}: ${[c.limit && `limit ${amountLabel(c.limit)}`, c.deductible && `deductible ${amountLabel(c.deductible)}`].filter(Boolean).join(", ")}`,
    ),
    ...(changes.terms?.adjustment
      ? [
          `Premium ${Number(changes.terms.adjustment.percent) >= 0 ? "loading" : "credit"} ${changes.terms.adjustment.percent}%: ${changes.terms.adjustment.reason}`,
        ]
      : []),
    ...(changes.conditions ?? []).map((c) => `Condition: ${c}`),
    ...(changes.subjectivities ?? []).map((s) => `Subjectivity: ${s}`),
    ...(changes.reasonCodes ?? []).map((c) => `Reason: ${c}`),
  ];

  return (
    <div className="grid gap-1 border-t pt-4 text-sm">
      {decision.note && <p className="m-0">{decision.note}</p>}
      {lines.map((line) => (
        <p key={line} className="m-0 text-muted-foreground first-letter:uppercase">
          {line}
        </p>
      ))}
      {changes.writtenPremium && (
        <p className="m-0 text-muted-foreground tabular-nums">
          Written premium on approval {formatMoney(changes.writtenPremium)}
        </p>
      )}
    </div>
  );
}

function Conversation({ referral }: { referral: Referral }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");

  const note = useMutation(
    trpc.underwriting.note.mutationOptions({
      onSuccess: () => {
        setText("");

        void queryClient.invalidateQueries({
          queryKey: trpc.underwriting.referral.queryKey({ id: referral.id }),
        });
      },
    }),
  );

  return (
    <Panel
      title="Conversation and history"
      description="Messages with the producer, internal notes and every decision."
      flush
    >
      <ol className="m-0 grid list-none gap-0 divide-y p-0">
        {referral.entries.map((e) => (
          <li key={e.id} className="flex gap-3 px-(--card-p) py-3">
            <span
              aria-hidden
              className={cn(
                "mt-1.5 size-1.5 shrink-0 rounded-full",
                e.kind === "message"
                  ? e.author.role === "producer"
                    ? "bg-primary"
                    : "bg-foreground/60"
                  : "bg-muted-foreground/40",
              )}
            />
            <div className="grid min-w-0 flex-1 gap-0.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium">
                  {e.author.name}
                  {e.kind === "message" && (
                    <span className="font-normal text-muted-foreground">
                      {e.visibility === "internal"
                        ? " · internal note"
                        : e.author.role === "producer"
                          ? " · producer"
                          : " · to the producer"}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {formatDateTime(e.at)}
                </span>
              </div>
              <p
                className={cn(
                  "m-0 text-sm whitespace-pre-wrap",
                  e.kind === "action" && "text-muted-foreground",
                )}
              >
                {e.body}
              </p>
            </div>
          </li>
        ))}
      </ol>
      <div className="grid gap-2 border-t bg-muted/40 px-(--card-p) py-3">
        <Label htmlFor="uw-note" className="sr-only">
          Internal note
        </Label>
        <Textarea
          id="uw-note"
          rows={2}
          value={text}
          placeholder="Add an internal note"
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            disabled={!text.trim() || note.isPending}
            onClick={() => note.mutate({ id: referral.id, message: text })}
          >
            {note.isPending && <Spinner />}
            Add note
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function AtThisAddress({ submissionId }: { submissionId: string }) {
  const trpc = useTRPC();
  const clearance = useQuery(trpc.submissions.clearance.queryOptions({ id: submissionId }));
  const conflicts = clearance.data?.conflicts ?? [];

  return (
    <Panel
      title="At this address"
      description="Other active submissions and policies at the same location, from the address registry."
      flush
    >
      {conflicts.length === 0 ? (
        <p className="m-0 px-(--card-p) py-4 text-sm text-muted-foreground">
          {clearance.isPending ? "Checking…" : "Nothing else is active at this location."}
        </p>
      ) : (
        <ul className="m-0 list-none divide-y p-0">
          {conflicts.map((c) => (
            <li
              key={`${c.subjectKind}:${c.subjectId}`}
              className="flex items-center gap-3 px-(--card-p) py-3 text-sm"
            >
              {c.subjectKind === "policy" ? (
                <Link
                  to="/policies/$policyId"
                  params={{ policyId: c.subjectId }}
                  className="font-medium text-primary tabular-nums hover:underline"
                >
                  {c.label}
                </Link>
              ) : (
                <Link
                  to="/submissions/$submissionId"
                  params={{ submissionId: c.subjectId }}
                  className="font-medium text-primary tabular-nums hover:underline"
                >
                  {c.label}
                </Link>
              )}
              <span className="text-muted-foreground">
                {c.subjectKind === "policy" ? "Policy" : "Submission"}
              </span>
              {c.producerName && (
                <span className="ml-auto text-muted-foreground">{c.producerName}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Facts({ detail, canDecide }: { detail: ReferralDetail; canDecide: boolean }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const now = useEnvironment().data?.now;
  const r = detail.referral;
  const open = IN_QUEUE.includes(r.status);

  const assign = useMutation(
    trpc.underwriting.assign.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.underwriting.pathKey() }),
    }),
  );

  const overdue = open && now !== undefined && Date.parse(now) > Date.parse(r.dueAt);

  return (
    <Panel title="Details" className="lg:sticky lg:top-20">
      <dl className="m-0 grid gap-4">
        <Fact label="Review by">
          <span className={cn("tabular-nums", overdue && "font-medium text-red-700")}>
            {formatDateTime(r.dueAt)}
            {overdue && " · overdue"}
          </span>
        </Fact>
        <Fact label="Assignee">
          {canDecide && open ? (
            <div className="flex items-center gap-2">
              <Select
                value={r.assignee?.id ?? "none"}
                onValueChange={(value) =>
                  assign.mutate({ id: r.id, assigneeId: value === "none" ? null : value })
                }
              >
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {detail.underwriters.map((u) => (
                    <SelectItem key={u.userId} value={u.userId}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {r.assignee?.id !== detail.me.userId && detail.me.userId && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={assign.isPending}
                  onClick={() => assign.mutate({ id: r.id, assigneeId: detail.me.userId })}
                >
                  Claim
                </Button>
              )}
            </div>
          ) : (
            (r.assignee?.name ?? <span className="text-muted-foreground">Unassigned</span>)
          )}
        </Fact>
        <Fact label="Needs">{r.requiredAuthority ?? `Level ${r.requiredLevel}`}</Fact>
        <Fact label="Your authority">
          {detail.me.profile?.name ?? <span className="text-muted-foreground">None</span>}
        </Fact>
        <Fact label="Written premium">
          <span className="tabular-nums">{formatMoney(r.writtenPremium)}</span>
        </Fact>
        <Fact label="Total insured value">
          <span className="tabular-nums">{formatMoney(r.insuredValue)}</span>
        </Fact>
        <Fact label="Insured">
          {r.insuredName ?? <span className="text-muted-foreground">Not captured</span>}
        </Fact>
        <Fact label="Submission">
          <Link
            to="/submissions/$submissionId"
            params={{ submissionId: r.submissionId }}
            className="font-medium text-primary tabular-nums hover:underline"
          >
            {r.submissionNumber}
          </Link>{" "}
          <span className="text-muted-foreground">revision {r.quoteRevision}</span>
        </Fact>
        <Fact label="Product">
          {r.productName} ·{" "}
          {jurisdictionName({ country: r.jurisdiction.slice(0, 2), subdivision: r.jurisdiction })}
        </Fact>
        <Fact label="Producer">{r.producer.name}</Fact>
        {detail.history.length > 0 && (
          <Fact label="Earlier referrals">
            <ul className="m-0 grid list-none gap-1 p-0">
              {detail.history.map((h) => (
                <li key={h.id}>
                  <Link
                    to="/underwriting/referrals/$referralId"
                    params={{ referralId: h.id }}
                    className="text-primary hover:underline"
                  >
                    {formatDate(h.openedAt)}
                  </Link>{" "}
                  <span className="text-muted-foreground">{h.status}</span>
                </li>
              ))}
            </ul>
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

function useInvalidate(id: string) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.underwriting.pathKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.submissions.pathKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.underwriting.referral.queryKey({ id }) }),
    ]);
}

function RequestInfoDialog({
  referralId,
  open,
  onClose,
}: {
  referralId: string;
  open: boolean;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const [message, setMessage] = useState("");
  const invalidate = useInvalidate(referralId);
  const request = useMutation(trpc.underwriting.requestInfo.mutationOptions());

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();

    request.mutate(
      { id: referralId, message },
      { onSuccess: async () => (setMessage(""), await invalidate(), onClose()) },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <form onSubmit={onSubmit} className="grid gap-6">
          <DialogHeader>
            <DialogTitle>Ask the producer</DialogTitle>
            <DialogDescription>
              They see it on the quote in the app. Their answer puts the referral back in the queue.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="uw-ask">Message</Label>
            <Textarea
              id="uw-ask"
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
          {request.error && (
            <Notice tone="error" title="Couldn't send it">
              {request.error.message}
            </Notice>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={request.isPending || !message.trim()}>
              {request.isPending && <Spinner />}
              Send to producer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeclineDialog({
  referralId,
  open,
  onClose,
}: {
  referralId: string;
  open: boolean;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const settings = useQuery(trpc.underwriting.settings.get.queryOptions());
  const [codes, setCodes] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const invalidate = useInvalidate(referralId);
  const decline = useMutation(trpc.underwriting.decline.mutationOptions());
  const reasons = settings.data?.declineReasons ?? [];
  const chosen = reasons.filter((r) => codes.includes(r.code));

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();

    decline.mutate(
      { id: referralId, reasonCodes: codes, ...(note.trim() && { note: note.trim() }) },
      { onSuccess: async () => (await invalidate(), onClose()) },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <form onSubmit={onSubmit} className="grid gap-6">
          <DialogHeader>
            <DialogTitle>Decline the referral</DialogTitle>
            <DialogDescription>
              The producer sees the reasons. The adverse-action wording comes from your underwriting
              settings.
            </DialogDescription>
          </DialogHeader>
          <fieldset className="m-0 grid gap-3 border-0 p-0">
            <legend className="mb-2 text-sm font-medium">Reasons</legend>
            {reasons.length === 0 && (
              <p className="m-0 text-sm text-muted-foreground">
                No decline reasons are configured. Add them in Settings → Underwriting.
              </p>
            )}
            {reasons.map((r) => (
              <label key={r.code} className="flex items-start gap-2.5 text-sm">
                <Checkbox
                  checked={codes.includes(r.code)}
                  onCheckedChange={(checked) =>
                    setCodes((current) =>
                      checked ? [...current, r.code] : current.filter((c) => c !== r.code),
                    )
                  }
                  className="mt-0.5"
                />
                <span className="grid gap-0.5">
                  <span>{r.label}</span>
                  <span className="font-mono text-xs text-muted-foreground">{r.code}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {chosen.length > 0 && (
            <div className="grid gap-1 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Adverse-action wording</span>
              {chosen.map((r) => (
                <p key={r.code} className="m-0">
                  {r.adverseActionNotice}
                </p>
              ))}
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="uw-decline-note">
              Note <span className="font-normal text-muted-foreground">optional</span>
            </Label>
            <Textarea
              id="uw-decline-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          {decline.error && (
            <Notice tone="error" title="Couldn't decline">
              {decline.error.message}
            </Notice>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={decline.isPending || codes.length === 0}
            >
              {decline.isPending && <Spinner />}
              Decline quote
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface Slot {
  coverage: string;
  name: string;
  exposure: string | null;
  label: string | null;
  limits: Amount[];
  deductibles: Amount[];
  limit: Amount | null;
  deductible: Amount | null;
}

const slotKey = (s: Slot) => `${s.coverage}@${s.exposure ?? ""}`;

function slotsOf(quote: StaffQuote): Slot[] {
  return quote.coverages.flatMap((c) =>
    c.exposures
      .filter((e) => e.selected && (c.limits.length > 1 || c.deductibles.length > 1))
      .map((e) => ({
        coverage: c.code,
        name: c.name,
        exposure: e.exposure,
        label: e.label,
        limits: c.limits,
        deductibles: c.deductibles,
        limit: e.limit,
        deductible: e.deductible,
      })),
  );
}

function ApproveDialog({
  referral,
  me,
  quote,
  open,
  onClose,
}: {
  referral: Referral;
  me: ReferralDetail["me"];
  quote: StaffQuote;
  open: boolean;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const invalidate = useInvalidate(referral.id);
  const slots = slotsOf(quote);

  const [changes, setChanges] = useState<Record<string, { limit?: string; deductible?: string }>>(
    {},
  );

  const [percent, setPercent] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [conditions, setConditions] = useState("");
  const [subjectivities, setSubjectivities] = useState<DraftSubjectivity[]>([]);
  const [escalated, setEscalated] = useState<string[] | null>(null);
  const approve = useMutation(trpc.underwriting.approve.mutationOptions());

  const coverages = slots.flatMap((s) => {
    const change = changes[slotKey(s)];

    const limit =
      change?.limit !== undefined ? s.limits.find((a) => amountKey(a) === change.limit) : undefined;

    const deductible =
      change?.deductible !== undefined
        ? s.deductibles.find((a) => amountKey(a) === change.deductible)
        : undefined;

    const changed =
      (limit && amountKey(limit) !== amountKey(s.limit)) ||
      (deductible && amountKey(deductible) !== amountKey(s.deductible));

    return changed
      ? [
          {
            coverage: s.coverage,
            ...(s.exposure && { exposure: s.exposure }),
            ...(limit && { limit }),
            ...(deductible && { deductible }),
          },
        ]
      : [];
  });

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();

    approve.mutate(
      {
        id: referral.id,
        ...(note.trim() && { note: note.trim() }),
        conditions: conditions
          .split("\n")
          .map((c) => c.trim())
          .filter(Boolean),
        terms: {
          coverages,
          adjustment: percent.trim()
            ? { percent: percent.trim(), reason: reason.trim() || "Underwriter adjustment" }
            : null,
        },
        subjectivities: subjectivities
          .filter((s) => s.title.trim())
          .map((s) => ({ ...s, ...(s.timing === "pre_bind" && { dueDays: undefined }) })),
      },
      {
        onSuccess: async (result) => {
          await invalidate();

          if (result.outcome === "escalated") setEscalated(result.problems);
          else onClose();
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && (setEscalated(null), onClose())}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={onSubmit} className="grid max-h-[80vh] gap-6 overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Approve the referral</DialogTitle>
            <DialogDescription>
              Changes re-rate the quote on its pinned release. Beyond your authority
              {me.profile ? ` (${me.profile.name.toLowerCase()})` : ""}, it escalates instead.
            </DialogDescription>
          </DialogHeader>
          {escalated ? (
            <Notice tone="warning" title="Escalated for a higher authority">
              {escalated.join("; ")}. It's back in the queue for someone who can approve it.
            </Notice>
          ) : (
            <>
              {slots.length > 0 && (
                <section className="grid gap-3">
                  <h3 className="m-0 text-sm font-medium">Coverage changes</h3>
                  {slots.map((s) => {
                    const key = slotKey(s);

                    return (
                      <div
                        key={key}
                        className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_10rem]"
                      >
                        <span className="grid gap-0.5 text-sm">
                          <span className="font-medium">{s.name}</span>
                          {s.label && (
                            <span className="text-xs text-muted-foreground">{s.label}</span>
                          )}
                        </span>
                        <AmountSelect
                          label="Limit"
                          options={s.limits}
                          value={changes[key]?.limit ?? amountKey(s.limit)}
                          onChange={(limit) =>
                            setChanges((c) => ({ ...c, [key]: { ...c[key], limit } }))
                          }
                        />
                        <AmountSelect
                          label="Deductible"
                          options={s.deductibles}
                          value={changes[key]?.deductible ?? amountKey(s.deductible)}
                          onChange={(deductible) =>
                            setChanges((c) => ({ ...c, [key]: { ...c[key], deductible } }))
                          }
                        />
                      </div>
                    );
                  })}
                </section>
              )}
              <section className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
                <div className="grid gap-2">
                  <Label htmlFor="uw-percent">
                    Loading or credit <span className="font-normal text-muted-foreground">%</span>
                  </Label>
                  <Input
                    id="uw-percent"
                    inputMode="decimal"
                    className="tabular-nums"
                    placeholder="0"
                    value={percent}
                    onChange={(e) => setPercent(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="uw-percent-reason">
                    Why <span className="font-normal text-muted-foreground">optional</span>
                  </Label>
                  <Input
                    id="uw-percent-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </div>
              </section>
              <section className="grid gap-3">
                <div className="flex items-center justify-between">
                  <h3 className="m-0 text-sm font-medium">Subjectivities</h3>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setSubjectivities((s) => [...s, blankSubjectivity()])}
                  >
                    <Plus /> Add
                  </Button>
                </div>
                {subjectivities.length === 0 && (
                  <p className="m-0 text-sm text-muted-foreground">None added.</p>
                )}
                {subjectivities.map((s, i) => (
                  <div key={i} className="relative rounded-lg border p-3">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label="Remove"
                      className="absolute top-1 right-1 size-7"
                      onClick={() => setSubjectivities((all) => all.filter((_, j) => j !== i))}
                    >
                      <X />
                    </Button>
                    <SubjectivityFields
                      idPrefix={`approve-subjectivity-${i}`}
                      value={s}
                      onChange={(next) =>
                        setSubjectivities((all) => all.map((x, j) => (j === i ? next : x)))
                      }
                    />
                  </div>
                ))}
              </section>
              <div className="grid gap-2">
                <Label htmlFor="uw-conditions">
                  Conditions shown on the quote{" "}
                  <span className="font-normal text-muted-foreground">optional, one per line</span>
                </Label>
                <Textarea
                  id="uw-conditions"
                  rows={2}
                  value={conditions}
                  onChange={(e) => setConditions(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="uw-approve-note">
                  Note to the producer{" "}
                  <span className="font-normal text-muted-foreground">optional</span>
                </Label>
                <Textarea
                  id="uw-approve-note"
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
              {approve.error && (
                <Notice tone="error" title="Couldn't approve">
                  {approve.error.message}
                </Notice>
              )}
            </>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => (setEscalated(null), onClose())}>
              {escalated ? "Close" : "Cancel"}
            </Button>
            {!escalated && (
              <Button type="submit" disabled={approve.isPending}>
                {approve.isPending && <Spinner />}
                Approve
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AmountSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Amount[];
  value: string;
  onChange: (value: string) => void;
}) {
  if (options.length <= 1) return <span />;

  return (
    <div className="grid gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger size="sm" className="tabular-nums">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((a) => (
            <SelectItem key={amountKey(a)} value={amountKey(a)}>
              {amountLabel(a)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
