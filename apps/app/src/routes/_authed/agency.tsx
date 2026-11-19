import { EmptyState } from "@pas/ui/components/empty-state";
import { Panel } from "@pas/ui/components/panel";
import { StatusChip } from "@pas/ui/components/status-chip";
import { jurisdictionName } from "@pas/ui/lib/jurisdictions";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Building, ScrollText } from "lucide-react";
import { formatMoney, formatPlainDate } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/agency")({
  component: MyAgencyPage,
});

/** An agency admin's view: their agencies and sub-agencies, producers and the book written through them. */
function MyAgencyPage() {
  const trpc = useTRPC();
  const agencies = useQuery(trpc.agency.mine.queryOptions());
  const policies = useQuery(trpc.policies.list.queryOptions({ limit: 200 }));

  const roots = (agencies.data ?? []).filter(
    (a) => !agencies.data?.some((p) => p.id === a.parentId),
  );

  return (
    <>
      <div className="grid gap-1">
        <h1 className="m-0 text-2xl leading-tight font-semibold tracking-tight">My agency</h1>
        <p className="m-0 text-sm text-muted-foreground">
          {agencies.data?.map((a) => a.name).join(", ") || "Your agencies, producers and book."}
        </p>
      </div>
      {agencies.error ? (
        <Panel>
          <EmptyState
            icon={<Building />}
            title="No agency to manage"
            description="Agency admins see their agency's producers and book here."
          />
        </Panel>
      ) : (
        roots.map((agency) => <AgencyProducers key={agency.id} agencyId={agency.id} />)
      )}
      <Panel
        title="Book"
        description="Policies written through your agency and its sub-agencies."
        flush
      >
        {policies.data?.length === 0 ? (
          <EmptyState icon={<ScrollText />} title="No policies yet" />
        ) : (
          <ul className="m-0 list-none divide-y p-0">
            {policies.data?.map((policy) => (
              <li key={policy.id}>
                <Link
                  to="/policies/$policyId"
                  params={{ policyId: policy.id }}
                  className="flex items-center justify-between gap-4 px-(--card-p) py-3.5 outline-none hover:bg-muted/40 focus-visible:bg-muted/40"
                >
                  <span className="grid min-w-0 gap-0.5">
                    <span className="truncate text-sm leading-5 font-medium">
                      {policy.insuredName}
                    </span>
                    <span className="truncate text-xs text-muted-foreground tabular-nums">
                      {policy.number} · {policy.producerName}
                      {policy.producerAgency && ` · ${policy.producerAgency}`} ·{" "}
                      {jurisdictionName(policy.jurisdiction)} ·{" "}
                      {formatPlainDate(policy.effectiveDate)}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-medium tabular-nums">
                    {formatMoney(policy.writtenPremium)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

function AgencyProducers({ agencyId }: { agencyId: string }) {
  const trpc = useTRPC();
  const agency = useQuery(trpc.agency.get.queryOptions({ id: agencyId }));

  if (!agency.data) return <div className="h-40 animate-pulse rounded-xl bg-muted/60" />;

  return (
    <Panel
      title={agency.data.name}
      description={
        agency.data.children.length > 0
          ? `With ${agency.data.children.map((c) => c.name).join(", ")}`
          : undefined
      }
      flush
    >
      <ul className="m-0 list-none divide-y p-0">
        {agency.data.producers.map((producer) => {
          const attention = producer.licenses.find((l) => l.health !== "current");

          return (
            <li
              key={producer.id}
              className="flex items-center justify-between gap-4 px-(--card-p) py-3.5"
            >
              <span className="grid min-w-0 gap-0.5">
                <span className="truncate text-sm leading-5 font-medium">{producer.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {producer.licenses.map((l) => jurisdictionName(l)).join(", ") ||
                    "No licenses on file"}
                </span>
              </span>
              {attention ? (
                <StatusChip tone={attention.health === "expired" ? "danger" : "warning"}>
                  {attention.health === "expired" ? "License expired" : "License expiring"}
                </StatusChip>
              ) : (
                <StatusChip tone={producer.status === "active" ? "success" : "accent"}>
                  {producer.status === "active" ? "Active" : "Invited"}
                </StatusChip>
              )}
            </li>
          );
        })}
        {agency.data.children.map((child) => (
          <li
            key={child.id}
            className="flex items-center justify-between gap-4 bg-muted/30 px-(--card-p) py-3 text-sm"
          >
            <span className="font-medium">{child.name}</span>
            <span className="text-xs text-muted-foreground tabular-nums">
              Sub-agency · {child.producerCount}{" "}
              {child.producerCount === 1 ? "producer" : "producers"}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
