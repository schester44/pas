import { Button } from "@pas/ui/components/button";
import { EmptyState } from "@pas/ui/components/empty-state";
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pas/ui/components/table";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Building, Plus } from "lucide-react";
import { useState } from "react";
import { AgencyDialog } from "@/components/distribution/agency-dialog";
import { type Agency, AgencyStatus, tierLabel } from "@/components/distribution/format";
import { useAccess } from "@/lib/permissions";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/agencies/")({
  component: AgenciesPage,
});

/** Parents first, each followed by its sub-agencies, so the hierarchy reads top to bottom. */
function inHierarchy(agencies: readonly Agency[]): { agency: Agency; depth: number }[] {
  const ids = new Set(agencies.map((a) => a.id));
  const roots = agencies.filter((a) => !a.parentId || !ids.has(a.parentId));

  const walk = (agency: Agency, depth: number): { agency: Agency; depth: number }[] => [
    { agency, depth },
    ...agencies.filter((a) => a.parentId === agency.id).flatMap((a) => walk(a, depth + 1)),
  ];

  return roots.flatMap((root) => walk(root, 0));
}

function AgenciesPage() {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const access = useAccess();
  const agencies = useQuery(trpc.distribution.agencies.list.queryOptions());
  const scope = useQuery(trpc.distribution.scope.queryOptions());
  const [creating, setCreating] = useState(false);
  const rows = inHierarchy(agencies.data ?? []);

  const open = (agency: Agency) =>
    navigate({ to: "/agencies/$agencyId", params: { agencyId: agency.id } });

  return (
    <>
      <PageHeader
        title="Agencies"
        actions={
          access.agencies.write &&
          scope.data?.kind === "tenant" && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus /> New agency
            </Button>
          )
        }
      />
      <PageBody className="max-w-6xl">
        <Panel flush>
          {agencies.error ? (
            <EmptyState
              icon={<Building />}
              title="Couldn't load agencies"
              description="Refresh the page to try again."
            />
          ) : agencies.data?.length === 0 ? (
            <EmptyState
              icon={<Building />}
              title="No agencies yet"
              description="Agencies and their producers show up here."
            />
          ) : (
            <>
              <Table className="hidden lg:table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Agency</TableHead>
                    <TableHead>Tier</TableHead>
                    <TableHead>Agency bill</TableHead>
                    <TableHead className="text-right">Producers</TableHead>
                    <TableHead>Licenses</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agencies.isPending &&
                    Array.from({ length: 3 }, (_, i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={6}>
                          <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
                        </TableCell>
                      </TableRow>
                    ))}
                  {rows.map(({ agency, depth }) => (
                    <TableRow
                      key={agency.id}
                      className="h-13 cursor-pointer hover:bg-muted/40"
                      onClick={() => open(agency)}
                    >
                      <TableCell>
                        <span
                          className="flex items-center gap-2"
                          style={{ paddingLeft: depth * 20 }}
                        >
                          {depth > 0 && (
                            <span
                              aria-hidden
                              className="h-3 w-2.5 rounded-bl border-b border-l border-border"
                            />
                          )}
                          <Link
                            to="/agencies/$agencyId"
                            params={{ agencyId: agency.id }}
                            className="font-medium outline-none hover:underline focus-visible:underline"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {agency.name}
                          </Link>
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {tierLabel(agency.tier)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {agency.billing.eligible ? "Eligible" : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {agency.producerCount}
                      </TableCell>
                      <TableCell>
                        <LicenseSignal count={agency.licenseWarnings} />
                      </TableCell>
                      <TableCell>
                        <AgencyStatus status={agency.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <ul className="m-0 list-none divide-y p-0 lg:hidden">
                {rows.map(({ agency, depth }) => (
                  <li key={agency.id}>
                    <Link
                      to="/agencies/$agencyId"
                      params={{ agencyId: agency.id }}
                      className="grid gap-1 px-(--card-p) py-3.5 outline-none hover:bg-muted/40 focus-visible:bg-muted/40"
                    >
                      <span className="flex items-center justify-between gap-3">
                        <span className="truncate text-sm leading-5 font-medium">
                          {agency.name}
                        </span>
                        <AgencyStatus status={agency.status} />
                      </span>
                      <span className="truncate text-xs text-muted-foreground tabular-nums">
                        {[
                          depth > 0 && agency.parentName && `Under ${agency.parentName}`,
                          `${agency.producerCount} ${agency.producerCount === 1 ? "producer" : "producers"}`,
                          tierLabel(agency.tier),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      {agency.licenseWarnings > 0 && (
                        <LicenseSignal count={agency.licenseWarnings} />
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      </PageBody>
      <AgencyDialog open={creating} onOpenChange={setCreating} onSaved={open} />
    </>
  );
}

function LicenseSignal({ count }: { count: number }) {
  if (count === 0) return <span className="text-sm text-muted-foreground">Current</span>;

  return (
    <span className="flex items-center gap-1.5 text-sm text-amber-800">
      <span aria-hidden className="size-1.5 rounded-full bg-amber-500" />
      {count} need attention
    </span>
  );
}
