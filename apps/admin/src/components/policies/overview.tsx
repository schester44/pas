import { Button } from "@pas/ui/components/button";
import { Panel } from "@pas/ui/components/panel";
import { daysUntil } from "@pas/ui/lib/policy-change";
import { cn } from "@pas/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import type * as React from "react";
import { useState } from "react";
import { humanize } from "@/components/decisions/jdm-edit";
import { formatDate, formatPlainDate } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";
import { PolicyClients } from "./clients";
import { RescindDialog } from "./policy-actions";
import {
  amount,
  type Billing,
  exposureLabel,
  isZero,
  money,
  type Policy,
  transactionStatus,
  transactionType,
} from "./policy-format";
import { countdown } from "./policy-status";

/** What a person opening the policy needs first: where it stands, what's next, what's open. */
export function PolicyOverview({ policy, billing }: { policy: Policy; billing?: Billing }) {
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="grid gap-6">
        <StatusPanel policy={policy} billing={billing} />
        <KeyCoverages policy={policy} />
      </div>
      <div className="grid gap-6">
        <KeyDates policy={policy} billing={billing} />
        <OpenRequests policy={policy} />
        <PolicyClients policyId={policy.id} />
      </div>
    </div>
  );
}

function statusSentence(policy: Policy) {
  const term = `${formatPlainDate(policy.effectiveDate)} – ${formatPlainDate(policy.expirationDate)}`;
  const cancellation = policy.cancellation;

  switch (policy.status) {
    case "pending_effective":
      return `Coverage starts ${formatPlainDate(policy.effectiveDate)} and runs to ${formatPlainDate(policy.expirationDate)}.`;
    case "in_force":
      return `Coverage is in force for the term ${term}.`;
    case "pending_cancellation":
      return cancellation
        ? `Coverage continues until the cancellation takes effect on ${formatPlainDate(cancellation.effectiveDate)}, ${countdown(cancellation.effectiveDate)}. Reason: ${cancellation.reasonLabel.toLowerCase()}.`
        : "A cancellation is scheduled for this term.";
    case "cancelled":
      return cancellation
        ? `Cancelled effective ${formatPlainDate(cancellation.effectiveDate)}. Reason: ${cancellation.reasonLabel.toLowerCase()}.`
        : "This term was cancelled.";
    case "expired":
      return `The term ended on ${formatPlainDate(policy.expirationDate)}.`;
    default:
      return null;
  }
}

function StatusPanel({ policy, billing }: { policy: Policy; billing?: Billing }) {
  const [rescinding, setRescinding] = useState(false);
  const pending = policy.status === "pending_cancellation" ? policy.cancellation : null;
  const nonpayment = pending?.reason === "nonpayment" ? pending : null;

  const open =
    policy.openTransaction &&
    (policy.openTransaction.type !== "CANCELLATION" ||
      policy.openTransaction.status === "pending_approval")
      ? policy.openTransaction
      : null;

  const pastDue = billing?.pastDue && !isZero(billing.pastDue) ? billing.pastDue : null;

  const mailed = nonpayment
    ? policy.events.find(
        (e) => e.type === "notice_mailed" && e.data.transactionId === nonpayment.transactionId,
      )
    : undefined;

  const held = nonpayment
    ? policy.events.some(
        (e) => e.type === "cancellation_held" && e.data.transactionId === nonpayment.transactionId,
      )
    : false;

  return (
    <Panel
      title="Status"
      action={
        pending && (
          <>
            <Button size="sm" variant="outline" onClick={() => setRescinding(true)}>
              Rescind cancellation
            </Button>
            <RescindDialog policy={policy} open={rescinding} onOpenChange={setRescinding} />
          </>
        )
      }
    >
      <div className="grid gap-4">
        <p className="m-0 text-sm tabular-nums">{statusSentence(policy)}</p>
        {(pastDue || nonpayment || open) && (
          <ul className="m-0 grid list-none gap-2 p-0">
            {(pastDue || nonpayment) && (
              <Callout tone="danger">
                <span className="font-medium">
                  {pastDue ? `${money(pastDue)} past due` : "Past due"}
                </span>
                <span className="text-muted-foreground">
                  {nonpayment
                    ? `${mailed ? ` · Notice of intent mailed ${formatDate(mailed.occurredAt)}` : " · Notice of intent sent, no proof of mailing yet"}${held ? ` · Cancellation held since ${formatPlainDate(nonpayment.effectiveDate)}` : ` · Cancels ${formatPlainDate(nonpayment.effectiveDate)} unless paid`}`
                    : billing?.nextDue
                      ? ` · ${billing.nextDue.number} was due ${formatPlainDate(billing.nextDue.dueOn)}`
                      : ""}
                </span>
              </Callout>
            )}
            {open && (
              <Callout
                tone="accent"
                action={
                  <Button size="sm" variant="outline" asChild>
                    <Link
                      to={
                        open.type === "CANCELLATION"
                          ? "/policies/$policyId/cancel"
                          : "/policies/$policyId/endorse"
                      }
                      params={{ policyId: policy.id }}
                    >
                      Review
                    </Link>
                  </Button>
                }
              >
                <span className="font-medium">
                  {transactionType(open.type)} {transactionStatus(open.status).toLowerCase()}
                </span>
                <span className="text-muted-foreground">
                  {" "}
                  · effective {formatPlainDate(open.effectiveDate)} · {money(open.total)}
                </span>
              </Callout>
            )}
          </ul>
        )}
      </div>
    </Panel>
  );
}

function Callout({
  tone,
  action,
  children,
}: {
  tone: "danger" | "accent";
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2.5 text-sm">
      <span
        aria-hidden
        className={cn(
          "size-2 shrink-0 rounded-full",
          tone === "danger" ? "bg-red-500" : "bg-primary",
        )}
      />
      <span className="min-w-0 flex-1 tabular-nums">{children}</span>
      {action}
    </li>
  );
}

const KEY_COVERAGES = 5;

function KeyCoverages({ policy }: { policy: Policy }) {
  const shown = policy.coverages.slice(0, KEY_COVERAGES);
  const more = policy.coverages.length - shown.length;
  const exposures = new Set(policy.coverages.map((c) => c.exposure ?? "")).size;

  return (
    <Panel
      title="Coverages"
      description={`${policy.coverages.length} coverages${exposures > 1 ? ` across ${exposures} exposures` : ""}`}
      flush
      action={
        <Button size="sm" variant="ghost" asChild>
          <Link
            to="/policies/$policyId"
            params={{ policyId: policy.id }}
            search={{ tab: "coverage" }}
            resetScroll={false}
          >
            {more > 0 ? `View all ${policy.coverages.length}` : "Details"}
            <ArrowRight />
          </Link>
        </Button>
      }
    >
      <ul className="m-0 list-none divide-y p-0">
        {shown.map((c) => (
          <li
            key={`${c.coverage}@${c.exposure ?? ""}`}
            className="flex items-center gap-4 px-(--card-p) py-3"
          >
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="truncate text-sm font-medium">{c.name}</span>
              <span className="text-xs text-muted-foreground">{exposureLabel(c.exposure)}</span>
            </span>
            <span className="grid justify-items-end gap-0.5 text-right">
              <span className="text-sm tabular-nums">{amount(c.limit)}</span>
              <span className="text-xs text-muted-foreground">Limit</span>
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

interface KeyDate {
  label: string;
  date: string;
  tone?: "danger" | "warning";
}

function keyDates(policy: Policy, billing?: Billing): KeyDate[] {
  const dates: KeyDate[] = [];

  if (policy.status === "pending_effective")
    dates.push({ label: "Coverage starts", date: policy.effectiveDate });

  if (billing?.nextDue)
    dates.push({
      label: `${billing.nextDue.number} due · ${money(billing.nextDue.amount)}`,
      date: billing.nextDue.dueOn,
      ...(daysUntil(billing.nextDue.dueOn) < 0 && { tone: "danger" as const }),
    });

  if (policy.openTransaction && policy.openTransaction.type !== "CANCELLATION")
    dates.push({
      label: `${transactionType(policy.openTransaction.type)} effective`,
      date: policy.openTransaction.effectiveDate,
    });

  if (policy.cancellation?.status === "pending")
    dates.push({
      label: "Cancellation effective",
      date: policy.cancellation.effectiveDate,
      tone: "warning",
    });

  if (policy.status !== "cancelled" && policy.status !== "expired")
    dates.push({ label: "Term ends", date: policy.expirationDate });

  return dates.toSorted((a, b) => a.date.localeCompare(b.date));
}

function KeyDates({ policy, billing }: { policy: Policy; billing?: Billing }) {
  const dates = keyDates(policy, billing);

  return (
    <Panel title="Next dates" flush>
      {dates.length === 0 ? (
        <p className="m-0 px-(--card-p) py-4 text-sm text-muted-foreground">Nothing coming up.</p>
      ) : (
        <ol className="m-0 list-none divide-y p-0">
          {dates.map((d) => (
            <li key={`${d.label}-${d.date}`} className="flex items-start gap-3 px-(--card-p) py-3">
              <span
                aria-hidden
                className={cn(
                  "mt-1.5 size-1.5 shrink-0 rounded-full",
                  d.tone === "danger"
                    ? "bg-red-500"
                    : d.tone === "warning"
                      ? "bg-amber-500"
                      : "bg-muted-foreground/40",
                )}
              />
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate text-sm font-medium tabular-nums">{d.label}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatPlainDate(d.date)} · {relativeDays(d.date)}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

function relativeDays(date: string) {
  const days = daysUntil(date);

  if (days < 0) return days === -1 ? "1 day ago" : `${-days} days ago`;

  return countdown(date);
}

function OpenRequests({ policy }: { policy: Policy }) {
  const trpc = useTRPC();
  const requests = useQuery(trpc.policies.changeRequests.queryOptions({ id: policy.id }));
  const open = requests.data?.filter((r) => r.status === "open") ?? [];
  const referrals = policy.openTransaction?.referrals.filter((r) => r.outcome !== "approved") ?? [];

  return (
    <Panel title="Open requests" flush>
      {requests.isPending ? (
        <div className="px-(--card-p) py-3.5">
          <div className="h-9 animate-pulse rounded bg-muted" />
        </div>
      ) : open.length === 0 && referrals.length === 0 ? (
        <p className="m-0 px-(--card-p) py-4 text-sm text-muted-foreground">
          No open requests or referrals.
        </p>
      ) : (
        <ul className="m-0 list-none divide-y p-0">
          {referrals.map((r) => (
            <li key={r.reasonCode} className="grid gap-0.5 px-(--card-p) py-3">
              <span className="text-sm font-medium">Referral</span>
              <span className="text-xs text-muted-foreground">{r.message}</span>
            </li>
          ))}
          {open.map((r) => (
            <li key={r.id} className="grid gap-0.5 px-(--card-p) py-3">
              <span className="text-sm font-medium">{humanize(r.kind)} change</span>
              <span className="line-clamp-2 text-xs text-muted-foreground">{r.details}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {r.requestedBy.name} · {formatDate(r.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
