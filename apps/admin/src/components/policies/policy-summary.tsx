import { Card } from "@pas/ui/components/card";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/lib/trpc";
import { jurisdictionName } from "@pas/ui/lib/jurisdictions";
import { daysUntil } from "@pas/ui/lib/policy-change";
import type * as React from "react";
import { formatMoney, formatPlainDate, plural } from "@/lib/format";
import { PolicyActions } from "./policy-actions";
import { type Billing, isZero, type Policy } from "./policy-format";
import { PolicyStatus } from "./policy-status";

/** The facts people need at a glance: who, what, state, term, premium, balance, producer. */
export function PolicySummary({ policy, billing }: { policy: Policy; billing?: Billing }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-start justify-between gap-4 p-(--card-p)">
        <div className="grid min-w-0 gap-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h2 className="m-0 truncate text-2xl leading-8 font-semibold tracking-tight">
              {policy.insuredName}
            </h2>
            <PolicyStatus status={policy.status} cancellation={policy.cancellation} />
          </div>
          <p className="m-0 text-sm text-muted-foreground">
            {policy.productName} <span className="tabular-nums">{policy.productVersion}</span>
            {" · "}
            {jurisdictionName(policy.jurisdiction)}
          </p>
          <CarrierLine policyId={policy.id} />
        </div>
        <PolicyActions policy={policy} />
      </div>
      <dl className="m-0 grid grid-cols-2 gap-px border-t bg-border lg:grid-cols-4">
        <Fact label="Term" hint={termHint(policy)}>
          {formatPlainDate(policy.effectiveDate)} – {formatPlainDate(policy.expirationDate)}
        </Fact>
        <Fact
          label="Written premium"
          hint={
            !isZero(policy.taxesAndFees) && `+ ${formatMoney(policy.taxesAndFees)} taxes and fees`
          }
        >
          {formatMoney(policy.writtenPremium)}
        </Fact>
        <Fact label="Balance due" hint={billing && <BalanceHint billing={billing} />}>
          {billing ? (
            billing.balance ? (
              formatMoney(billing.balance)
            ) : (
              <span className="text-muted-foreground">–</span>
            )
          ) : (
            <span className="inline-block h-5 w-20 animate-pulse rounded bg-muted align-middle" />
          )}
        </Fact>
        <Fact label="Producer" hint={policy.producerAgency}>
          {policy.producerName}
        </Fact>
      </dl>
    </Card>
  );
}

function termHint(policy: Policy) {
  if (policy.cancellation?.status === "pending")
    return `Cancels ${formatPlainDate(policy.cancellation.effectiveDate)}`;

  if (policy.cancellation?.status === "effective")
    return `Cancelled ${formatPlainDate(policy.cancellation.effectiveDate)}`;

  if (policy.status === "pending_effective")
    return `Starts in ${plural(daysUntil(policy.effectiveDate), "day")}`;

  const left = daysUntil(policy.expirationDate);

  return left > 0 ? `Expires in ${plural(left, "day")}` : "Expired";
}

function BalanceHint({ billing }: { billing: Billing }) {
  if (billing.pastDue && !isZero(billing.pastDue))
    return (
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="size-1.5 rounded-full bg-red-500" />
        {formatMoney(billing.pastDue)} past due
      </span>
    );

  if (billing.nextDue) return `Next due ${formatPlainDate(billing.nextDue.dueOn)}`;

  return billing.balance && !isZero(billing.balance) ? null : "Paid in full";
}

function Fact({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="grid content-start gap-1 bg-card px-(--card-p) py-4">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="m-0 grid gap-0.5">
        <span className="text-sm leading-5 font-medium tabular-nums">{children}</span>
        {hint && <span className="text-xs text-muted-foreground tabular-nums">{hint}</span>}
      </dd>
    </div>
  );
}

/** The carrier that wrote the policy and its number for it (PLAN §12, policy number "both"). */
function CarrierLine({ policyId }: { policyId: string }) {
  const trpc = useTRPC();
  const link = useQuery(trpc.carriers.policyLink.queryOptions({ policyId }));

  if (!link.data) return null;

  return (
    <p className="m-0 text-sm text-muted-foreground">
      Written through {link.data.carrierName}
      {link.data.carrierPolicyNumber && (
        <>
          {" · carrier policy "}
          <span className="font-medium text-foreground tabular-nums">
            {link.data.carrierPolicyNumber}
          </span>
        </>
      )}
    </p>
  );
}
