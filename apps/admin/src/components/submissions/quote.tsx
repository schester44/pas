import type { AdminOutputs } from "@pas/api-client";
import type { DecisionTrace, MatchedRule, NodeTrace } from "@pas/decisions-engine";
import type { RiskSchema } from "@pas/forms-core";
import { Button } from "@pas/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@pas/ui/components/dialog";
import { Label } from "@pas/ui/components/label";
import { Notice } from "@pas/ui/components/notice";
import { Panel } from "@pas/ui/components/panel";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@pas/ui/components/sheet";
import { Spinner } from "@pas/ui/components/spinner";
import { StatusChip } from "@pas/ui/components/status-chip";
import { Textarea } from "@pas/ui/components/textarea";
import { jurisdictionName } from "@pas/ui/lib/jurisdictions";
import { cn } from "@pas/ui/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, Circle } from "lucide-react";
import type * as React from "react";
import { useMemo, useState } from "react";
import { OUTCOMES } from "@/components/decisions/results";
import { inputLabeler } from "@/components/decisions/input-label";
import { humanize } from "@/components/decisions/jdm-edit";
import type { Coverage } from "@/components/catalog/version-editor";
import { Worksheet } from "@/components/rating/worksheet";
import { formatDate, formatMoney } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";

export type StaffQuote = NonNullable<AdminOutputs["submissions"]["quote"]>;
type Amount = StaffQuote["coverages"][number]["limits"][number];
type Reason = StaffQuote["evaluation"]["reasons"][number];

const money = (value: { amount: string; currency: string }) =>
  formatMoney(value.amount, value.currency);

const amount = (value: Amount | null) =>
  !value ? (
    <span className="text-muted-foreground">–</span>
  ) : value.kind === "money" ? (
    formatMoney(value.amount, value.currency)
  ) : (
    `${value.value}%`
  );

const dateTime = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const percent = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 3 });

/** Premium by coverage and exposure, then taxes and fees: what the insured would pay. */
export function QuotePremium({ quote }: { quote: StaffQuote }) {
  const rows = quote.coverages.flatMap((coverage) =>
    coverage.exposures.filter((e) => e.selected).map((exposure) => ({ coverage, exposure })),
  );

  return (
    <Panel
      flush
      title="Quote"
      description={`Revision ${quote.revision} · valid until ${formatDate(quote.expiresAt)} · priced in ${quote.evaluatedInMs} ms`}
    >
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="h-10 bg-muted/40 text-left text-xs font-medium text-muted-foreground">
            <th className="pl-(--card-p) font-medium">Coverage</th>
            <th className="px-3 text-right font-medium">Limit</th>
            <th className="px-3 text-right font-medium">Deductible</th>
            <th className="pr-(--card-p) text-right font-medium">Premium</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ coverage, exposure }) => (
            <tr key={`${coverage.code}@${exposure.exposure ?? ""}`} className="h-13 border-t">
              <td className="py-2.5 pl-(--card-p)">
                <span className="grid gap-0.5">
                  <span className="font-medium">{coverage.name}</span>
                  {exposure.label && (
                    <span className="text-xs text-muted-foreground">{exposure.label}</span>
                  )}
                </span>
              </td>
              <td className="px-3 text-right tabular-nums">{amount(exposure.limit)}</td>
              <td className="px-3 text-right tabular-nums">{amount(exposure.deductible)}</td>
              <td className="pr-(--card-p) text-right tabular-nums">
                {exposure.premium ? money(exposure.premium) : "–"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="m-0 grid gap-1.5 border-t bg-muted/40 px-(--card-p) py-3 text-sm">
        <Line label="Written premium" value={money(quote.premium.written)} />
        {quote.premium.taxesFees.map((line) => (
          <Line
            key={line.code}
            label={line.label}
            meta={[
              line.rate !== undefined && percent.format(Number(line.rate)),
              line.basis === "flat" ? "flat" : `on ${humanize(line.basis).toLowerCase()}`,
            ]
              .filter(Boolean)
              .join(" ")}
            value={money(line.amount)}
          />
        ))}
        <div className="flex items-baseline gap-3 border-t pt-2 font-semibold">
          <dt className="flex-1">Total</dt>
          <dd className="m-0 tabular-nums">{money(quote.premium.total)}</dd>
        </div>
      </dl>
    </Panel>
  );
}

function Line({ label, meta, value }: { label: string; meta?: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="flex-1 text-muted-foreground">
        {label}
        {meta && <span className="ml-1.5 text-xs tabular-nums">{meta}</span>}
      </dt>
      <dd className="m-0 tabular-nums">{value}</dd>
    </div>
  );
}

/** The referral, why it happened, and the underwriter's call. */
export function ReferralPanel({
  quote,
  schema,
  submissionId,
  canDecide,
  referralId,
}: {
  quote: StaffQuote;
  schema: RiskSchema;
  submissionId: string;
  canDecide: boolean;
  referralId?: string;
}) {
  const [why, setWhy] = useState(false);
  const [deciding, setDeciding] = useState<"approve" | "decline" | null>(null);
  const referral = quote.referral;

  if (!referral) return null;

  const decision = referral.decision;
  const open = quote.status === "referred";

  return (
    <Panel
      title={open ? "Referred to underwriting" : "Underwriting referral"}
      description={
        open
          ? `Referred ${dateTime.format(new Date(referral.referredAt))}. Review by ${dateTime.format(new Date(referral.reviewBy))}.`
          : decision &&
            `${decision.outcome === "approved" ? "Approved" : "Declined"} by ${decision.by} on ${formatDate(decision.decidedAt)}.`
      }
      action={
        <Button variant="ghost" size="sm" onClick={() => setWhy(true)}>
          Why referred?
        </Button>
      }
      footer={
        referralId ? (
          <div className="flex justify-end">
            <Button variant={open ? "default" : "outline"} asChild>
              <Link to="/underwriting/referrals/$referralId" params={{ referralId }}>
                {open ? "Review in underwriting" : "Open in underwriting"}
              </Link>
            </Button>
          </div>
        ) : (
          open &&
          canDecide && (
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDeciding("decline")}>
                Decline
              </Button>
              <Button onClick={() => setDeciding("approve")}>Approve</Button>
            </div>
          )
        )
      }
    >
      <div className="grid gap-4">
        <Reasons reasons={referral.reasons} />
        {decision && (decision.note || decision.conditions.length > 0) && (
          <div className="grid gap-1 border-t pt-4 text-sm">
            {decision.note && <p className="m-0">{decision.note}</p>}
            {decision.conditions.map((condition) => (
              <p key={condition} className="m-0 text-muted-foreground">
                Condition: {condition}
              </p>
            ))}
          </div>
        )}
      </div>
      <WhySheet quote={quote} schema={schema} open={why} onOpenChange={setWhy} />
      <DecideDialog
        submissionId={submissionId}
        outcome={deciding}
        onClose={() => setDeciding(null)}
      />
    </Panel>
  );
}

export function Reasons({ reasons }: { reasons: Reason[] }) {
  return (
    <ul className="m-0 grid list-none gap-3 p-0">
      {reasons.map((reason) => (
        <li key={reason.reasonCode} className="flex items-start gap-3">
          <StatusChip tone={OUTCOMES[reason.outcome].tone} className="mt-px">
            {OUTCOMES[reason.outcome].label}
          </StatusChip>
          <span className="grid gap-0.5 text-sm">
            <span className="font-medium">{reason.message}</span>
            <span className="text-xs text-muted-foreground">
              {[
                reason.reasonCode,
                reason.authority && `Needs ${humanize(reason.authority).toLowerCase()}`,
                reason.internalMessage,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function matchedRules(node: NodeTrace) {
  const data = node.traceData;

  if (!data || node.type !== "decisionTableNode") return [];

  return (Array.isArray(data) ? data : [data]).flatMap((hit) => ("index" in hit ? [hit] : []));
}

const JURISDICTION = /^([A-Z]{2})-[A-Z0-9]{1,3}$/;

const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 });

function traceValue(value: unknown): string {
  if (value === null || value === undefined) return "–";

  if (typeof value === "boolean") return value ? "Yes" : "No";

  if (typeof value === "number") return number.format(value);

  if (typeof value === "string") {
    const code = JURISDICTION.exec(value);

    return code ? jurisdictionName({ country: code[1]!, subdivision: value }) : value;
  }

  return Array.isArray(value) ? value.map(traceValue).join(", ") : JSON.stringify(value);
}

function ruleInputs(rule: MatchedRule) {
  return (
    rule.inputs ??
    Object.entries(rule.reference_map).map(([field, value]) => ({ field, name: "", value }))
  );
}

/** The decision trace behind the outcome: which rules fired and on what values. */
export function WhySheet({
  quote,
  schema,
  open,
  onOpenChange,
}: {
  quote: StaffQuote;
  schema: RiskSchema;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [expressions, setExpressions] = useState(false);
  const label = useMemo(() => inputLabeler(schema), [schema]);

  const decisions = quote.evaluation.decisions.filter(
    (d) => d.kind === "underwriting" || d.kind === "eligibility" || d.kind === "referral_triggers",
  );

  const unlabelled = decisions.some((decision) =>
    Object.values((decision.trace ?? {}) as DecisionTrace)
      .flatMap(matchedRules)
      .some((rule) => !rule.inputs),
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Why this quote was referred</SheetTitle>
          <SheetDescription>
            The rules that fired when it was evaluated on{" "}
            {dateTime.format(new Date(quote.evaluation.evaluatedAt))}.
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          {decisions.map((decision) => {
            const nodes = Object.values((decision.trace ?? {}) as DecisionTrace);
            const fired = nodes.flatMap(matchedRules);
            const reasons = quote.evaluation.reasons.filter((r) => r.decision === decision.ref);

            return (
              <section key={decision.ref} className="grid gap-3">
                <h3 className="m-0 text-sm font-medium">{decision.name}</h3>
                {fired.length === 0 ? (
                  <p className="m-0 text-sm text-muted-foreground">No rule fired.</p>
                ) : (
                  <ol className="m-0 grid list-none gap-px overflow-hidden rounded-lg border bg-border p-0">
                    {fired.map((rule, index) => (
                      <li key={`${rule.ruleId}-${index}`} className="grid gap-2 bg-card px-3 py-3">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-sm font-medium">
                            {reasons[index]?.message ??
                              rule.description ??
                              `Rule ${rule.index + 1}`}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                            Row {rule.index + 1}
                          </span>
                        </div>
                        <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 text-sm">
                          {ruleInputs(rule).map((input) => (
                            <div key={input.field} className="contents">
                              <dt className="min-w-0 text-muted-foreground" title={input.field}>
                                {label(input.field, input.name)}
                                {expressions && (
                                  <code className="block truncate font-mono text-xs">
                                    {input.field}
                                  </code>
                                )}
                              </dt>
                              <dd className="m-0 text-right font-medium tabular-nums">
                                {traceValue(input.value)}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            );
          })}
          {unlabelled && (
            <p className="m-0 text-xs text-muted-foreground">
              This quote was evaluated before traces recorded column names, so labels come from the
              risk data. Requote to see the table's own labels.
            </p>
          )}
          <div>
            <Button
              variant="link"
              size="sm"
              className="h-auto px-0 text-muted-foreground"
              onClick={() => setExpressions((v) => !v)}
            >
              {expressions ? "Hide expressions" : "Show expressions"}
            </Button>
          </div>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

function DecideDialog({
  submissionId,
  outcome,
  onClose,
}: {
  submissionId: string;
  outcome: "approve" | "decline" | null;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [conditions, setConditions] = useState("");
  const decide = useMutation(trpc.submissions.decideReferral.mutationOptions());
  const approving = outcome === "approve";

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!outcome) return;

    decide.mutate(
      {
        submissionId,
        outcome,
        ...(note.trim() && { note: note.trim() }),
        ...(approving && {
          conditions: conditions
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean),
        }),
      },
      {
        onSuccess: (quote) => {
          queryClient.setQueryData(trpc.submissions.quote.queryKey({ submissionId }), quote);
          void queryClient.invalidateQueries({ queryKey: trpc.submissions.list.queryKey() });
          setNote("");
          setConditions("");
          onClose();
        },
      },
    );
  }

  return (
    <Dialog open={outcome !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <form onSubmit={onSubmit} className="grid gap-6">
          <DialogHeader>
            <DialogTitle>{approving ? "Approve the referral" : "Decline the referral"}</DialogTitle>
            <DialogDescription>
              {approving
                ? "The agent can continue to bind. Conditions show on the quote."
                : "The quote is declined and the agent sees the reasons."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="uw-note">
                Note <span className="font-normal text-muted-foreground">optional</span>
              </Label>
              <Textarea
                id="uw-note"
                value={note}
                rows={3}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            {approving && (
              <div className="grid gap-2">
                <Label htmlFor="uw-conditions">
                  Conditions <span className="font-normal text-muted-foreground">optional</span>
                </Label>
                <Textarea
                  id="uw-conditions"
                  value={conditions}
                  rows={3}
                  placeholder="One per line"
                  onChange={(e) => setConditions(e.target.value)}
                />
              </div>
            )}
          </div>
          {decide.error && (
            <Notice tone="error" title="Couldn't record the decision">
              {decide.error.message}
            </Notice>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={approving ? "default" : "destructive"}
              disabled={decide.isPending}
            >
              {decide.isPending && <Spinner />}
              {approving ? "Approve" : "Decline quote"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The bind checklist the release's decisions produced. */
export function RequirementsPanel({ quote }: { quote: StaffQuote }) {
  return (
    <Panel title="Bind requirements" flush>
      <ul className="m-0 list-none divide-y p-0">
        {quote.requirements.map((requirement) => (
          <li key={requirement.id} className="flex items-start gap-3 px-(--card-p) py-3">
            <span
              className={cn(
                "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full",
                requirement.satisfied
                  ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                  : "text-muted-foreground",
              )}
            >
              {requirement.satisfied ? (
                <Check className="size-2.5" strokeWidth={3} />
              ) : (
                <Circle className="size-3.5" />
              )}
            </span>
            <span className="grid gap-0.5 text-sm">
              <span className={cn(!requirement.satisfied && "text-muted-foreground")}>
                {requirement.title}
              </span>
              {(requirement.declinationsRequired || !requirement.blocking) && (
                <span className="text-xs text-muted-foreground">
                  {[
                    requirement.declinationsRequired &&
                      `${requirement.declinationsRequired} admitted declinations`,
                    !requirement.blocking && "Due after binding",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** The rater's worksheet for the quoted selection. */
export function QuoteWorksheet({ quote, schema }: { quote: StaffQuote; schema: RiskSchema }) {
  const rating = quote.evaluation.rating;

  if (!rating) return null;

  const coverages = quote.coverages.map((c) => ({ code: c.code, name: c.name })) as Coverage[];

  const premiums = quote.coverages.flatMap((c) =>
    c.exposures
      .filter((e) => e.selected && e.premium)
      .map((e) => ({
        coverage: c.code,
        ...(e.exposure && { exposure: e.exposure }),
        premium: e.premium!,
        calculated: e.premium!,
      })),
  );

  const preview = {
    status: "ok" as const,
    result: {
      currency: quote.currency,
      coverages: premiums,
      adjustments: rating.adjustments,
      factors: rating.factors,
      total: quote.premium.written,
      warnings: rating.warnings,
      worksheet: rating.worksheet,
      artifact: rating.artifact,
    },
  } as Parameters<typeof Worksheet>[0]["preview"];

  return (
    <Worksheet
      preview={preview}
      coverages={coverages}
      schema={schema}
      description={`${rating.artifact.key} ${rating.artifact.version}, step by step.`}
    />
  );
}
