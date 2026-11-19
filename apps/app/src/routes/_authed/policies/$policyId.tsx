import type { AppOutputs } from "@pas/api-client";
import { Notice } from "@pas/ui/components/notice";
import { Panel } from "@pas/ui/components/panel";
import { SubjectivitiesList } from "@/components/underwriting";
import { StatusChip, type StatusTone } from "@pas/ui/components/status-chip";
import { jurisdictionName } from "@pas/ui/lib/jurisdictions";
import { cn } from "@pas/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@pas/ui/components/button";
import { daysUntil, money } from "@pas/ui/lib/policy-change";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BillingSchedule, type PolicyBilling } from "@/components/policy/billing-schedule";
import { PayDialog } from "@/components/portal/pay-dialog";
import { PolicyDocumentList } from "@/components/policy-documents";
import { BackLink } from "@/components/submission-heading";
import { formatDate, formatPlainDate, formatPlainDateRange } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/policies/$policyId")({
  component: PolicyPage,
});

type Policy = AppOutputs["policies"]["get"];

const TERM_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  pending_effective: { label: "Pending effective", tone: "accent" },
  in_force: { label: "In force", tone: "success" },
  pending_cancellation: { label: "Pending cancellation", tone: "warning" },
  expired: { label: "Expired", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "danger" },
};

function PolicyPage() {
  const { policyId } = Route.useParams();
  const trpc = useTRPC();
  const policy = useQuery(trpc.policies.get.queryOptions({ id: policyId }));
  const billing = useQuery(trpc.policies.billing.queryOptions({ id: policyId }));
  const queryClient = useQueryClient();
  const setAutopay = useMutation(trpc.policies.setAutopay.mutationOptions());
  const [paying, setPaying] = useState<PolicyBilling["invoices"][number] | null>(null);

  if (policy.error) {
    return (
      <div className="grid gap-6">
        <BackLink />
        <Notice tone="error" title="Couldn't load this policy">
          {policy.error.message}
        </Notice>
      </div>
    );
  }

  if (!policy.data) {
    return (
      <div className="grid gap-6" aria-busy>
        <div className="h-16 w-72 animate-pulse rounded bg-muted" />
        <div className="h-80 animate-pulse rounded-xl bg-muted/60" />
      </div>
    );
  }

  const p = policy.data;
  const status = TERM_STATUS[p.status] ?? { label: p.status, tone: "neutral" as const };

  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <BackLink />
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <div className="grid gap-1">
            <h1 className="m-0 text-2xl leading-tight font-semibold tracking-tight tabular-nums">
              {p.number}
            </h1>
            <p className="m-0 text-sm text-muted-foreground tabular-nums">
              {p.insuredName} · {p.productName} · {jurisdictionName(p.jurisdiction)} ·{" "}
              {formatPlainDateRange(p.effectiveDate, p.expirationDate)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusChip tone={status.tone}>{status.label}</StatusChip>
            <Requests policy={p} />
          </div>
        </div>
      </div>
      <Callout policy={p} />
      <PayDialog invoice={paying} policyId={p.id} onOpenChange={() => setPaying(null)} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Timeline policy={p} />
        <div className="grid gap-6">
          <SubjectivitiesList policyId={p.id} />
          <Panel title="Documents" flush>
            <PolicyDocumentList policyId={p.id} documents={p.documents} />
          </Panel>
          {billing.data && (
            <BillingSchedule
              billing={billing.data}
              onPay={setPaying}
              onAutopay={async (input) => {
                const result = await setAutopay.mutateAsync({ policyId: p.id, ...input });
                await queryClient.invalidateQueries({ queryKey: trpc.policies.pathKey() });

                return result;
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

const OPEN_LABELS: Record<string, string> = {
  ENDORSEMENT: "Change",
  CANCELLATION: "Cancellation",
  REINSTATEMENT: "Reinstatement",
};

function Requests({ policy }: { policy: Policy }) {
  const trpc = useTRPC();
  const authority = useQuery(trpc.policies.changes.authority.queryOptions({ policyId: policy.id }));
  const changeable = policy.status === "pending_effective" || policy.status === "in_force";

  if (!authority.data?.create || !changeable || policy.openTransaction) return null;

  return (
    <>
      <Button variant="outline" size="sm" asChild>
        <Link to="/policies/$policyId/endorse" params={{ policyId: policy.id }}>
          Request a change
        </Link>
      </Button>
      <Button variant="outline" size="sm" asChild>
        <Link to="/policies/$policyId/cancel" params={{ policyId: policy.id }}>
          Request cancellation
        </Link>
      </Button>
    </>
  );
}

function Callout({ policy }: { policy: Policy }) {
  const open = policy.openTransaction;
  const pending = policy.status === "pending_cancellation" ? policy.cancellation : null;

  if (!open && !pending) return null;

  const days = pending ? daysUntil(pending.effectiveDate) : 0;

  return (
    <p className="m-0 flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm">
      <span
        aria-hidden
        className={cn("size-2 shrink-0 rounded-full", pending ? "bg-amber-500" : "bg-primary")}
      />
      {pending ? (
        <span>
          Cancels{" "}
          <span className="font-medium tabular-nums">{formatPlainDate(pending.effectiveDate)}</span>{" "}
          <span className="text-muted-foreground tabular-nums">
            (in {days} {days === 1 ? "day" : "days"}) · {pending.reasonLabel}
          </span>
        </span>
      ) : (
        open && (
          <span>
            {OPEN_LABELS[open.type] ?? "Change"}{" "}
            {open.status === "pending_approval" ? "waiting for approval" : "in progress"}{" "}
            <span className="text-muted-foreground tabular-nums">
              · effective {formatPlainDate(open.effectiveDate)} · {money(open.total)}
            </span>
          </span>
        )
      )}
    </p>
  );
}

function Timeline({ policy }: { policy: Policy }) {
  return (
    <Panel title="Activity">
      <ol className="m-0 grid list-none gap-5 p-0">
        {policy.events.map((event) => (
          <li key={event.id} className="flex items-start gap-3">
            <span
              aria-hidden
              className={cn(
                "mt-1.5 size-2 shrink-0 rounded-full",
                event.category === "transactional"
                  ? "bg-primary"
                  : event.type === "payment_failed"
                    ? "bg-red-500"
                    : "bg-muted-foreground/40",
              )}
            />
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="text-sm">{event.summary}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {formatDate(event.occurredAt)} · {event.actor.name}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
