import type { AppOutputs } from "@pas/api-client";
import { Notice } from "@pas/ui/components/notice";
import { Panel } from "@pas/ui/components/panel";
import { StatusChip, type StatusTone } from "@pas/ui/components/status-chip";
import { jurisdictionName } from "@pas/ui/lib/jurisdictions";
import { cn } from "@pas/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PolicyDocumentList } from "@/components/policy-documents";
import { BackLink } from "@/components/submission-heading";
import { formatDate, formatMoney, formatPlainDate, formatPlainDateRange } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/policies/$policyId")({
  component: PolicyPage,
});

type Policy = AppOutputs["policies"]["get"];

const TERM_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  pending_effective: { label: "Pending effective", tone: "accent" },
  in_force: { label: "In force", tone: "success" },
  expired: { label: "Expired", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "danger" },
};

const INVOICE_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  open: { label: "Open", tone: "warning" },
  partially_paid: { label: "Partially paid", tone: "warning" },
  paid: { label: "Paid", tone: "success" },
  void: { label: "Void", tone: "neutral" },
};

function PolicyPage() {
  const { policyId } = Route.useParams();
  const trpc = useTRPC();
  const policy = useQuery(trpc.policies.get.queryOptions({ id: policyId }));
  const billing = useQuery(trpc.policies.billing.queryOptions({ id: policyId }));

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
          <StatusChip tone={status.tone}>{status.label}</StatusChip>
        </div>
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Timeline policy={p} />
        <div className="grid gap-6">
          <Panel title="Documents" flush>
            <PolicyDocumentList policyId={p.id} documents={p.documents} />
          </Panel>
          <Panel title="Invoices" flush>
            <ul className="m-0 list-none divide-y p-0">
              {billing.data?.invoices.map((invoice) => {
                const s = INVOICE_STATUS[invoice.status] ?? {
                  label: invoice.status,
                  tone: "neutral" as const,
                };

                return (
                  <li key={invoice.id} className="flex items-center gap-3 px-(--card-p) py-3">
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="text-sm font-medium tabular-nums">{invoice.number}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        Due {formatPlainDate(invoice.dueOn)}
                      </span>
                    </span>
                    <StatusChip tone={s.tone}>{s.label}</StatusChip>
                    <span className="text-sm tabular-nums">
                      {formatMoney(invoice.total, { cents: true })}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
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
