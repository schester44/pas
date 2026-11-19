import { Button } from "@pas/ui/components/button";
import { EmptyState } from "@pas/ui/components/empty-state";
import { Notice } from "@pas/ui/components/notice";
import { Panel } from "@pas/ui/components/panel";
import { StatusChip } from "@pas/ui/components/status-chip";
import { jurisdictionName } from "@pas/ui/lib/jurisdictions";
import { cn } from "@pas/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Mail, MessageSquare } from "lucide-react";
import { useState } from "react";
import { ChangeRequestDialog } from "@/components/portal/change-request-dialog";
import { PayDialog } from "@/components/portal/pay-dialog";
import { BillingSchedule, type PolicyBilling } from "@/components/policy/billing-schedule";
import { PolicyDocumentList } from "@/components/policy-documents";
import {
  formatDate,
  formatMoney,
  formatPlainDate,
  formatPlainDateRange,
  formatRelative,
  initials,
} from "@/lib/format";
import { amountText, type ClientPolicy, exposureText, policyStatus } from "@/lib/portal";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_portal/portal/policies/$policyId")({
  component: ClientPolicyPage,
});

const CHANGE_LABELS: Record<string, string> = {
  address: "Mailing address",
  mortgagee: "Mortgagee or lender",
  coverage: "Coverage",
  other: "Change",
};

function ClientPolicyPage() {
  const { policyId } = Route.useParams();
  const trpc = useTRPC();
  const policy = useQuery(trpc.client.policies.get.queryOptions({ id: policyId }));
  const billing = useQuery(trpc.client.policies.billing.queryOptions({ id: policyId }));
  const setAutopay = useMutation(trpc.client.policies.setAutopay.mutationOptions());
  const queryClient = useQueryClient();
  const [paying, setPaying] = useState<PolicyBilling["invoices"][number] | null>(null);
  const [requesting, setRequesting] = useState(false);

  if (policy.error) {
    return (
      <div className="grid gap-6">
        <BackLink />
        <Notice
          tone="error"
          title={
            policy.error.data?.code === "NOT_FOUND"
              ? "We couldn't find that policy"
              : "Couldn't load this policy"
          }
        >
          {policy.error.data?.code === "NOT_FOUND"
            ? "It may belong to another account. Go back to see your policies."
            : "Refresh the page to try again."}
        </Notice>
      </div>
    );
  }

  if (!policy.data) {
    return (
      <div className="grid gap-6" aria-busy>
        <div className="grid gap-3">
          <div className="h-4 w-24 animate-pulse rounded bg-muted" />
          <div className="h-8 w-64 animate-pulse rounded bg-muted" />
          <div className="h-4 w-80 animate-pulse rounded bg-muted/70" />
        </div>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="h-80 animate-pulse rounded-xl bg-muted/60" />
          <div className="h-80 animate-pulse rounded-xl bg-muted/60" />
        </div>
      </div>
    );
  }

  const p = policy.data;
  const status = policyStatus(p.status);

  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <BackLink />
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="grid min-w-0 gap-1">
            <h1 className="m-0 text-2xl leading-tight font-semibold tracking-tight">
              {p.productName}
            </h1>
            <p className="m-0 text-sm text-muted-foreground tabular-nums">
              {p.number} · {formatPlainDateRange(p.effectiveDate, p.expirationDate)}
            </p>
          </div>
          <StatusChip tone={status.tone}>{status.label}</StatusChip>
        </div>
      </div>

      {p.status === "pending_cancellation" && p.cancellation && (
        <p className="m-0 flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm">
          <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-amber-500" />
          <span>
            Your policy is scheduled to cancel on{" "}
            <span className="font-medium tabular-nums">
              {formatPlainDate(p.cancellation.effectiveDate)}
            </span>
            .{" "}
            <span className="text-muted-foreground">
              Contact {p.agent.name} if you have questions.
            </span>
          </span>
        </p>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="order-2 grid gap-6 lg:order-1">
          <Coverage policy={p} />
          <Panel title="Documents" flush>
            {p.documents.length === 0 ? (
              <EmptyState title="No documents yet" />
            ) : (
              <PolicyDocumentList policyId={p.id} documents={p.documents} audience="client" />
            )}
          </Panel>
          <Activity policy={p} />
        </div>
        <div className="order-1 grid gap-6 lg:order-2">
          {billing.data ? (
            <BillingSchedule
              billing={billing.data}
              onPay={setPaying}
              onAutopay={async (input) => {
                const result = await setAutopay.mutateAsync({ policyId: p.id, ...input });
                await queryClient.invalidateQueries({ queryKey: trpc.client.pathKey() });

                return result;
              }}
            />
          ) : (
            <div className="h-48 animate-pulse rounded-xl border bg-card" />
          )}
          <Agent policy={p} onRequest={() => setRequesting(true)} />
        </div>
      </div>

      <PayDialog invoice={paying} onOpenChange={() => setPaying(null)} />
      <ChangeRequestDialog
        policyId={p.id}
        agentName={p.agent.name}
        open={requesting}
        onOpenChange={setRequesting}
      />
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/portal"
      className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" /> Your policies
    </Link>
  );
}

function Coverage({ policy }: { policy: ClientPolicy }) {
  return (
    <Panel
      title="Coverage"
      description={`${policy.insuredName} · ${jurisdictionName(policy.jurisdiction)}`}
      flush
      footer={
        <dl className="m-0 grid gap-1.5 text-sm tabular-nums">
          <div className="flex justify-between gap-4 text-muted-foreground">
            <dt>Premium</dt>
            <dd className="m-0">{formatMoney(policy.writtenPremium, { cents: true })}</dd>
          </div>
          <div className="flex justify-between gap-4 text-muted-foreground">
            <dt>Taxes and fees</dt>
            <dd className="m-0">{formatMoney(policy.taxesAndFees, { cents: true })}</dd>
          </div>
          <div className="flex justify-between gap-4 font-medium">
            <dt>Total for the term</dt>
            <dd className="m-0">{formatMoney(policy.premium, { cents: true })}</dd>
          </div>
        </dl>
      }
    >
      <ul className="m-0 list-none divide-y p-0">
        {policy.coverages.map((coverage, index) => {
          const limit = amountText(coverage.limit);
          const deductible = amountText(coverage.deductible);
          const exposure = coverage.exposureLabel ?? exposureText(coverage.exposure);

          return (
            <li key={index} className="flex items-start gap-4 px-(--card-p) py-3.5">
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="text-sm leading-5 font-medium">{coverage.name}</span>
                {(limit || deductible || exposure) && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {[exposure, limit && `${limit} limit`, deductible && `${deductible} deductible`]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                )}
              </span>
              <span className="text-sm tabular-nums">
                {formatMoney(coverage.premium, { cents: true })}
              </span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function Agent({ policy, onRequest }: { policy: ClientPolicy; onRequest: () => void }) {
  const { agent } = policy;

  return (
    <Panel
      title="Your agent"
      footer={
        policy.changeRequests.length > 0 && (
          <ul className="m-0 grid list-none gap-2.5 p-0">
            {policy.changeRequests.map((request) => (
              <li key={request.id} className="flex items-start gap-3 text-sm">
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="font-medium">
                    {CHANGE_LABELS[request.kind] ?? "Change"} request
                  </span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">
                    {request.details}
                  </span>
                </span>
                <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                  {request.status === "open" ? "Sent" : "Done"} {formatRelative(request.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )
      }
    >
      <div className="grid gap-4">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
            {initials(agent.name)}
          </span>
          <span className="grid min-w-0">
            <span className="truncate text-sm font-medium">{agent.name}</span>
            <span className="truncate text-xs text-muted-foreground">
              {agent.agency ?? "Producer of record"}
            </span>
          </span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
          <Button variant="outline" onClick={onRequest}>
            <MessageSquare /> Request a change
          </Button>
          {agent.email && (
            <Button variant="outline" asChild>
              <a
                href={`mailto:${agent.email}?subject=${encodeURIComponent(`Policy ${policy.number}`)}`}
              >
                <Mail /> Email {agent.name.split(" ")[0]}
              </a>
            </Button>
          )}
        </div>
      </div>
    </Panel>
  );
}

function Activity({ policy }: { policy: ClientPolicy }) {
  return (
    <Panel title="Activity">
      {policy.timeline.length === 0 ? (
        <EmptyState title="Nothing here yet" />
      ) : (
        <ol className="m-0 grid list-none gap-5 p-0">
          {policy.timeline.map((event) => (
            <li key={event.id} className="flex items-start gap-3">
              <span
                aria-hidden
                className={cn(
                  "mt-1.5 size-2 shrink-0 rounded-full",
                  event.category === "transactional" ? "bg-primary" : "bg-muted-foreground/40",
                )}
              />
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="text-sm">{event.summary}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatDate(event.occurredAt)}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
