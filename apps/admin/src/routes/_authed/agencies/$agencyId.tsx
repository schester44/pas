import { Button } from "@pas/ui/components/button";
import { EmptyState } from "@pas/ui/components/empty-state";
import { Notice } from "@pas/ui/components/notice";
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import { SegmentedControl } from "@pas/ui/components/segmented-control";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pas/ui/components/table";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BadgeCheck, Building2, Plus, Users } from "lucide-react";
import { useState } from "react";
import { StatementsTable } from "@/components/billing/statements";
import { Breadcrumb } from "@/components/catalog/breadcrumb";
import { AgencyDialog } from "@/components/distribution/agency-dialog";
import { AgencyStatement } from "@/components/distribution/agency-statement";
import {
  type AgencyDetail,
  AgencyStatus,
  expiryLabel,
  Fact,
  LicenseHealth,
  ProducerStatus,
  stateName,
  tierLabel,
} from "@/components/distribution/format";
import { InviteProducerDialog } from "@/components/distribution/invite-producer-dialog";
import { formatMoney, formatPlainDate } from "@/lib/format";
import { useAccess } from "@/lib/permissions";
import { useTRPC } from "@/lib/trpc";

const TABS = ["producers", "licenses", "appointments", "statement", "account"] as const;
type Tab = (typeof TABS)[number];

export const Route = createFileRoute("/_authed/agencies/$agencyId")({
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } =>
    TABS.includes(search.tab as Tab) && search.tab !== "producers"
      ? { tab: search.tab as Tab }
      : {},
  component: AgencyPage,
});

function AgencyPage() {
  const { agencyId } = Route.useParams();
  const { tab = "producers" } = Route.useSearch();
  const navigate = Route.useNavigate();
  const trpc = useTRPC();
  const access = useAccess();
  const agency = useQuery(trpc.distribution.agencies.get.queryOptions({ id: agencyId }));
  const scope = useQuery(trpc.distribution.scope.queryOptions());
  const [editing, setEditing] = useState(false);
  const [inviting, setInviting] = useState(false);
  const staff = scope.data?.kind === "tenant";

  return (
    <>
      <PageHeader
        title={
          <Breadcrumb
            parents={[
              <Link key="agencies" to="/agencies">
                Agencies
              </Link>,
            ]}
            current={agency.data?.name}
          />
        }
        actions={
          access.agencies.write &&
          agency.data && (
            <>
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button size="sm" onClick={() => setInviting(true)}>
                <Plus /> Invite producer
              </Button>
            </>
          )
        }
      />
      <PageBody className="max-w-6xl">
        {agency.error ? (
          <Notice tone="error" title="Couldn't load this agency">
            {agency.error.message}
          </Notice>
        ) : !agency.data ? (
          <>
            <div className="h-40 animate-pulse rounded-xl bg-muted/60" />
            <div className="h-80 animate-pulse rounded-xl bg-muted/60" />
          </>
        ) : (
          <>
            {agency.data.billing.suspension && (
              <Notice tone="warning" title="Agency bill suspended">
                {agency.data.billing.suspension.reason}. New binds fall back to direct bill until
                the account is current; existing policies stay in force.
              </Notice>
            )}
            <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
              <AgencySummary agency={agency.data} />
              <Hierarchy agency={agency.data} />
            </div>
            <div className="grid gap-4">
              <SegmentedControl
                label="Agency sections"
                value={tab}
                className="w-fit"
                onValueChange={(next) =>
                  navigate({
                    search: next === "producers" ? {} : { tab: next },
                    resetScroll: false,
                  })
                }
                options={[
                  { value: "producers", label: `Producers ${agency.data.producers.length}` },
                  { value: "licenses", label: "Licenses" },
                  { value: "appointments", label: "Appointments" },
                  { value: "statement", label: "Commissions" },
                  ...(agency.data.billing.eligible || agency.data.billing.suspension
                    ? [{ value: "account" as const, label: "Account current" }]
                    : []),
                ]}
              />
              {tab === "producers" && (
                <ProducersPanel agency={agency.data} onInvite={() => setInviting(true)} />
              )}
              {tab === "licenses" && <LicensesPanel agency={agency.data} />}
              {tab === "appointments" && <AppointmentsPanel agency={agency.data} />}
              {tab === "account" && <StatementsTable agencyId={agency.data.id} />}
              {tab === "statement" && (
                <AgencyStatement
                  agencyId={agency.data.id}
                  hasSubAgencies={agency.data.children.length > 0}
                />
              )}
            </div>
            <AgencyDialog
              open={editing}
              onOpenChange={setEditing}
              agency={agency.data}
              canMove={staff}
            />
            <InviteProducerDialog agency={agency.data} open={inviting} onOpenChange={setInviting} />
          </>
        )}
      </PageBody>
    </>
  );
}

function AgencySummary({ agency }: { agency: AgencyDetail }) {
  const address = agency.address;

  return (
    <Panel title={agency.legalName ?? agency.name} action={<AgencyStatus status={agency.status} />}>
      <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
        <Fact label="FEIN">{agency.fein ?? "—"}</Fact>
        <Fact label="Commission tier">{tierLabel(agency.tier)}</Fact>
        <Fact label="Agency bill">
          {agency.billing.suspension
            ? "Suspended"
            : agency.billing.eligible
              ? [
                  agency.billing.remittanceBasis === "net" ? "Net of commission" : "Gross",
                  agency.billing.remittanceDays !== null && `${agency.billing.remittanceDays} days`,
                  agency.billing.creditLimit &&
                    `${formatMoney(agency.billing.creditLimit.amount, agency.billing.creditLimit.currency)} limit`,
                ]
                  .filter(Boolean)
                  .join(" · ") || "Eligible"
              : "Not eligible"}
        </Fact>
        <Fact label="Email">{agency.email ?? "—"}</Fact>
        <Fact label="Phone">{agency.phone ?? "—"}</Fact>
        <Fact label="Address">
          {address
            ? `${address.line1}, ${address.city}, ${address.region} ${address.postalCode}`
            : "—"}
        </Fact>
      </dl>
    </Panel>
  );
}

function Hierarchy({ agency }: { agency: AgencyDetail }) {
  return (
    <Panel title="Hierarchy" flush>
      <ul className="m-0 list-none divide-y p-0 text-sm">
        {agency.parent && (
          <li className="flex items-center justify-between gap-3 px-(--card-p) py-3">
            <Link
              to="/agencies/$agencyId"
              params={{ agencyId: agency.parent.id }}
              className="font-medium hover:underline"
            >
              {agency.parent.name}
            </Link>
            <span className="text-xs text-muted-foreground">Parent</span>
          </li>
        )}
        <li className="flex items-center justify-between gap-3 bg-primary/5 px-(--card-p) py-3">
          <span className="font-medium">{agency.name}</span>
          <span className="text-xs text-muted-foreground">This agency</span>
        </li>
        {agency.children.map((child) => (
          <li
            key={child.id}
            className="flex items-center justify-between gap-3 px-(--card-p) py-3 pl-8"
          >
            <Link
              to="/agencies/$agencyId"
              params={{ agencyId: child.id }}
              className="font-medium hover:underline"
            >
              {child.name}
            </Link>
            <span className="text-xs text-muted-foreground tabular-nums">
              {child.producerCount} {child.producerCount === 1 ? "producer" : "producers"}
            </span>
          </li>
        ))}
        {agency.children.length === 0 && (
          <li className="px-(--card-p) py-3 text-muted-foreground">No sub-agencies</li>
        )}
      </ul>
    </Panel>
  );
}

function ProducersPanel({ agency, onInvite }: { agency: AgencyDetail; onInvite: () => void }) {
  const access = useAccess();

  if (agency.producers.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon={<Users />}
          title="No producers yet"
          description="Invite the agents who sell for this agency."
          action={
            access.agencies.write && (
              <Button size="sm" variant="outline" onClick={onInvite}>
                Invite producer
              </Button>
            )
          }
        />
      </Panel>
    );
  }

  return (
    <Panel flush>
      <ul className="m-0 list-none divide-y p-0">
        {agency.producers.map((producer) => {
          const role = producer.memberships.find((m) => m.agencyId === agency.id)?.role;
          const attention = producer.licenses.filter((l) => l.health !== "current").length;

          return (
            <li key={producer.id}>
              <Link
                to="/agencies/producers/$producerId"
                params={{ producerId: producer.id }}
                className="flex items-center justify-between gap-4 px-(--card-p) py-3.5 outline-none hover:bg-muted/40 focus-visible:bg-muted/40"
              >
                <span className="grid min-w-0 gap-0.5">
                  <span className="truncate text-sm leading-5 font-medium">{producer.name}</span>
                  <span className="truncate text-xs text-muted-foreground tabular-nums">
                    {[
                      producer.email,
                      producer.npn && `NPN ${producer.npn}`,
                      role === "admin" && "Agency admin",
                      `${producer.licenses.length} ${producer.licenses.length === 1 ? "license" : "licenses"}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  {attention > 0 && (
                    <span className="hidden items-center gap-1.5 text-xs text-amber-800 sm:flex">
                      <span aria-hidden className="size-1.5 rounded-full bg-amber-500" />
                      License needs attention
                    </span>
                  )}
                  <ProducerStatus status={producer.status} />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function LicensesPanel({ agency }: { agency: AgencyDetail }) {
  const rows = agency.producers.flatMap((producer) =>
    producer.licenses.map((license) => ({ producer, license })),
  );

  const attention = rows.filter(
    (r) => r.license.health === "expiring" || r.license.health === "expired",
  );

  return (
    <div className="grid gap-4">
      {attention.length > 0 && (
        <Notice
          tone="warning"
          title={`${attention.length} ${attention.length === 1 ? "license needs" : "licenses need"} renewing`}
        >
          {attention
            .map(
              (r) =>
                `${r.producer.name}'s ${stateName(r.license)} license ${r.license.health === "expired" ? "expired" : "expires"} ${expiryLabel(r.license)}`,
            )
            .join("; ")}
          . Binds there are blocked once a license lapses.
        </Notice>
      )}
      <Panel flush>
        {rows.length === 0 ? (
          <EmptyState
            icon={<BadgeCheck />}
            title="No licenses on file"
            description="Add licenses on each producer's page."
          />
        ) : (
          <>
            <Table className="hidden lg:table">
              <TableHeader>
                <TableRow>
                  <TableHead>Producer</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>License</TableHead>
                  <TableHead>Lines of authority</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ producer, license }) => (
                  <TableRow key={license.id} className="h-13">
                    <TableCell>
                      <Link
                        to="/agencies/producers/$producerId"
                        params={{ producerId: producer.id }}
                        className="font-medium hover:underline"
                      >
                        {producer.name}
                      </Link>
                    </TableCell>
                    <TableCell>{stateName(license)}</TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {license.licenseNumber}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {license.linesOfAuthority.join(", ")}
                    </TableCell>
                    <TableCell className="tabular-nums">{expiryLabel(license)}</TableCell>
                    <TableCell>
                      <LicenseHealth health={license.health} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <ul className="m-0 list-none divide-y p-0 lg:hidden">
              {rows.map(({ producer, license }) => (
                <li key={license.id} className="grid gap-1 px-(--card-p) py-3.5">
                  <span className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-medium">
                      {producer.name} · {stateName(license)}
                    </span>
                    <LicenseHealth health={license.health} />
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {license.licenseNumber} · {license.linesOfAuthority.join(", ")} ·{" "}
                    {expiryLabel(license)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>
    </div>
  );
}

function AppointmentsPanel({ agency }: { agency: AgencyDetail }) {
  return (
    <Panel flush>
      {agency.appointments.length === 0 ? (
        <EmptyState
          icon={<Building2 />}
          title="No appointments"
          description="Carrier appointments for this agency show up here."
        />
      ) : (
        <ul className="m-0 list-none divide-y p-0">
          {agency.appointments.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-4 px-(--card-p) py-3.5">
              <span className="grid gap-0.5">
                <span className="text-sm leading-5 font-medium">{a.carrier}</span>
                <span className="text-xs text-muted-foreground">{stateName(a)}</span>
              </span>
              <span className="text-sm text-muted-foreground tabular-nums">
                Since {formatPlainDate(a.effectiveDate)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
