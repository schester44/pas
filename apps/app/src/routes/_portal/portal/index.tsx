import { Button } from "@pas/ui/components/button";
import { Card } from "@pas/ui/components/card";
import { EmptyState } from "@pas/ui/components/empty-state";
import { Notice } from "@pas/ui/components/notice";
import { Panel } from "@pas/ui/components/panel";
import { StatusChip } from "@pas/ui/components/status-chip";
import { useQueries, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, FileText } from "lucide-react";
import { useState } from "react";
import { ClaimForm } from "@/components/portal/claim-form";
import { PayDialog } from "@/components/portal/pay-dialog";
import { PolicyDocumentList } from "@/components/policy-documents";
import { formatMoney, formatPlainDate, formatPlainDateRange } from "@/lib/format";
import {
  type ClientInvoice,
  type ClientPolicySummary,
  isDue,
  policyStatus,
  totalDue,
} from "@/lib/portal";
import { useTenant } from "@/lib/tenant";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_portal/portal/")({
  component: PortalHome,
});

function PortalHome() {
  const trpc = useTRPC();
  const tenant = useTenant();
  const me = useQuery(trpc.client.me.queryOptions());
  const policies = useQuery(trpc.client.policies.list.queryOptions());
  const invoices = useQuery(trpc.client.invoices.list.queryOptions());
  const [paying, setPaying] = useState<ClientInvoice | null>(null);
  const [adding, setAdding] = useState(false);

  const firstName =
    me.data?.accounts.find((a) => a.firstName)?.firstName ?? me.data?.user.name.split(" ")[0];

  const due = (invoices.data ?? []).filter(isDue);
  const owed = totalDue(invoices.data ?? []);

  if (me.error) {
    return (
      <Notice tone="error" title="We couldn't load your account">
        Refresh the page to try again.
      </Notice>
    );
  }

  if (me.data && !me.data.linked) {
    return <ClaimFirst brand={tenant?.displayName} email={me.data.user.email} />;
  }

  return (
    <>
      <div className="grid gap-1">
        <h1 className="m-0 text-2xl leading-tight font-semibold tracking-tight">
          {firstName ? `Hi, ${firstName}` : "Welcome back"}
        </h1>
        <p className="m-0 text-sm text-muted-foreground tabular-nums">
          {policies.data
            ? `${policies.data.length} ${policies.data.length === 1 ? "policy" : "policies"}${tenant ? ` with ${tenant.displayName}` : ""} · ${owed ? `${formatMoney(owed, { cents: true })} due` : "Nothing due"}`
            : " "}
        </p>
      </div>

      {due.length > 0 && (
        <Panel title="Due now" flush>
          <ul className="m-0 list-none divide-y p-0">
            {due.map((invoice) => (
              <li key={invoice.id} className="flex items-center gap-4 px-(--card-p) py-3.5">
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="text-sm leading-5 font-medium tabular-nums">
                    {formatMoney(invoice.balance, { cents: true })}
                  </span>
                  <span className="truncate text-xs text-muted-foreground tabular-nums">
                    {invoice.policyNumber} · Due {formatPlainDate(invoice.dueOn)}
                  </span>
                </span>
                <Button size="sm" onClick={() => setPaying(invoice)}>
                  Pay
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <section className="grid gap-4">
        <h2 className="m-0 text-base leading-6 font-semibold">Your policies</h2>
        {policies.error ? (
          <Notice tone="error" title="Couldn't load your policies">
            Refresh the page to try again.
          </Notice>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {policies.isPending && [0, 1].map((i) => <PolicyCardSkeleton key={i} />)}
            {policies.data?.map((policy) => (
              <PolicyCard key={policy.id} policy={policy} />
            ))}
          </div>
        )}
        <div>
          {adding ? (
            <Panel
              title="Add a policy"
              description="Don't see one of yours? Enter its number and the ZIP code it's mailed to."
            >
              <ClaimForm onLinked={() => setAdding(false)} />
            </Panel>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="text-sm font-medium text-primary hover:underline"
            >
              Don't see a policy? Add it
            </button>
          )}
        </div>
      </section>

      <RecentDocuments policies={policies.data} />

      <PayDialog invoice={paying} onOpenChange={() => setPaying(null)} />
    </>
  );
}

function PolicyCard({ policy }: { policy: ClientPolicySummary }) {
  const status = policyStatus(policy.status);

  return (
    <Link
      to="/portal/policies/$policyId"
      params={{ policyId: policy.id }}
      className="group rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <Card className="h-full transition-colors group-hover:border-primary/25">
        <div className="grid gap-4 p-(--card-p)">
          <div className="flex items-start justify-between gap-3">
            <div className="grid min-w-0 gap-0.5">
              <span className="truncate text-base leading-6 font-semibold">
                {policy.productName}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">{policy.number}</span>
            </div>
            <StatusChip tone={status.tone}>{status.label}</StatusChip>
          </div>
          <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-4 text-sm">
            <div className="grid gap-0.5">
              <dt className="text-xs text-muted-foreground">Term</dt>
              <dd className="m-0 tabular-nums">
                {formatPlainDateRange(policy.effectiveDate, policy.expirationDate)}
              </dd>
            </div>
            <div className="grid gap-0.5 text-right">
              <dt className="text-xs text-muted-foreground">Premium</dt>
              <dd className="m-0 tabular-nums">{formatMoney(policy.premium, { cents: true })}</dd>
            </div>
          </dl>
        </div>
        <div className="mt-auto flex items-center gap-3 border-t px-(--card-p) py-3">
          <span className="grid min-w-0 flex-1">
            <span className="text-xs text-muted-foreground">Your agent</span>
            <span className="truncate text-sm font-medium">
              {policy.agent.name}
              {policy.agent.agency && (
                <span className="font-normal text-muted-foreground"> · {policy.agent.agency}</span>
              )}
            </span>
          </span>
          <ChevronRight
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
          />
        </div>
      </Card>
    </Link>
  );
}

function PolicyCardSkeleton() {
  return (
    <Card>
      <div className="grid gap-4 p-(--card-p)">
        <div className="grid gap-1.5">
          <div className="h-5 w-40 animate-pulse rounded bg-muted" />
          <div className="h-3 w-24 animate-pulse rounded bg-muted/70" />
        </div>
        <div className="h-9 animate-pulse rounded bg-muted/50" />
      </div>
      <div className="h-[61px] border-t" />
    </Card>
  );
}

function RecentDocuments({ policies }: { policies: ClientPolicySummary[] | undefined }) {
  const trpc = useTRPC();

  const details = useQueries({
    queries: (policies ?? []).map((p) => trpc.client.policies.get.queryOptions({ id: p.id })),
  });

  const loading = !policies || details.some((d) => d.isPending);

  const documents = details
    .flatMap((d) =>
      (d.data?.documents ?? []).map((doc) => ({ ...doc, policyId: d.data!.id, policy: d.data! })),
    )
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 4);

  return (
    <Panel title="Recent documents" flush>
      {!loading && documents.length === 0 ? (
        <EmptyState icon={<FileText />} title="No documents yet" />
      ) : (
        <div className="divide-y">
          {loading && <PolicyDocumentList policyId="" documents={undefined} audience="client" />}
          {documents.map((doc) => (
            <div key={doc.id}>
              <PolicyDocumentList
                policyId={doc.policyId}
                documents={[{ ...doc, detail: doc.policy.number }]}
                audience="client"
              />
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function ClaimFirst({ brand, email }: { brand: string | undefined; email: string }) {
  return (
    <div className="mx-auto grid w-full max-w-xl gap-6 pt-4">
      <div className="grid gap-1">
        <h1 className="m-0 text-2xl leading-tight font-semibold tracking-tight">
          Find your policy
        </h1>
        <p className="m-0 text-sm text-muted-foreground">
          We don't have a policy{brand ? ` with ${brand}` : ""} for{" "}
          <span className="font-medium text-foreground">{email}</span> yet. Enter one of your policy
          numbers and the ZIP code it's mailed to.
        </p>
      </div>
      <Card>
        <div className="p-(--card-p)">
          <ClaimForm />
        </div>
      </Card>
    </div>
  );
}
