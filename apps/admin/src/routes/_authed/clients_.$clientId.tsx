import { Button } from "@pas/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@pas/ui/components/dropdown-menu";
import { EmptyState } from "@pas/ui/components/empty-state";
import { Notice } from "@pas/ui/components/notice";
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Ellipsis } from "lucide-react";
import { useState } from "react";
import { Breadcrumb } from "@/components/catalog/breadcrumb";
import {
  type MergeCandidate,
  MergeDialog,
  PickClientDialog,
} from "@/components/clients/merge-dialog";
import { PARTY_ROLE_LABELS, portalState } from "@/components/policies/clients";
import { PolicyStatus } from "@/components/policies/policy-status";
import { formatDate, formatMoney, formatPlainDate, formatRelative } from "@/lib/format";
import { useAccess } from "@/lib/permissions";
import { useTRPC } from "@/lib/trpc";
import { useRecordView } from "@/lib/recent-views";

export const Route = createFileRoute("/_authed/clients_/$clientId")({
  component: ClientPage,
});

function ClientPage() {
  const { clientId } = Route.useParams();
  const trpc = useTRPC();
  const navigate = useNavigate();
  const access = useAccess();
  const client = useQuery(trpc.clients.get.queryOptions({ id: clientId }));
  const [picking, setPicking] = useState(false);
  const [other, setOther] = useState<MergeCandidate | null>(null);
  const c = client.data;

  useRecordView("client", clientId);

  return (
    <>
      <PageHeader
        title={
          <Breadcrumb
            parents={[
              <Link key="clients" to="/clients">
                Clients
              </Link>,
            ]}
            current={c?.displayName}
          />
        }
        actions={
          c &&
          access.policies.update && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="More actions">
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setPicking(true)}>
                  Merge with another client
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )
        }
      />
      <PageBody className="max-w-6xl">
        {client.error ? (
          <Notice tone="error" title="Couldn't load this client">
            {client.error.message}
          </Notice>
        ) : !c ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="h-72 animate-pulse rounded-xl bg-muted/60" />
            <div className="h-48 animate-pulse rounded-xl bg-muted/60" />
          </div>
        ) : (
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="grid gap-6">
              <Panel title="Policies" flush>
                {c.policies.length === 0 ? (
                  <EmptyState title="No policies linked" />
                ) : (
                  <ul className="m-0 list-none divide-y p-0">
                    {c.policies.map((p) => (
                      <li key={p.id}>
                        <Link
                          to="/policies/$policyId"
                          params={{ policyId: p.id }}
                          className="flex items-center justify-between gap-4 px-(--card-p) py-3 outline-none hover:bg-muted/40 focus-visible:bg-muted/40"
                        >
                          <span className="grid min-w-0 gap-0.5">
                            <span className="text-sm leading-5 font-medium tabular-nums">
                              {p.number}
                            </span>
                            <span className="truncate text-xs text-muted-foreground tabular-nums">
                              {p.productName} · {formatPlainDate(p.effectiveDate)} –{" "}
                              {formatPlainDate(p.expirationDate)} ·{" "}
                              {p.roles.map((r) => PARTY_ROLE_LABELS[r] ?? r).join(", ")}
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-4">
                            <span className="hidden text-sm tabular-nums sm:inline">
                              {formatMoney(p.total.amount, p.total.currency)}
                            </span>
                            <PolicyStatus status={p.status} />
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
              {c.submissions.length > 0 && (
                <Panel title="Submissions" flush>
                  <ul className="m-0 list-none divide-y p-0">
                    {c.submissions.map((s) => (
                      <li key={s.id}>
                        <Link
                          to="/submissions/$submissionId"
                          params={{ submissionId: s.id }}
                          className="flex items-center justify-between gap-4 px-(--card-p) py-3 outline-none hover:bg-muted/40 focus-visible:bg-muted/40"
                        >
                          <span className="grid min-w-0 gap-0.5">
                            <span className="text-sm leading-5 font-medium tabular-nums">
                              {s.number}
                            </span>
                            <span className="truncate text-xs text-muted-foreground">
                              {s.productName}
                            </span>
                          </span>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            Updated {formatRelative(s.updatedAt)}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}
              <Panel title="Recent activity" flush>
                {c.activity.length === 0 ? (
                  <EmptyState title="Nothing yet" />
                ) : (
                  <ol className="m-0 list-none divide-y p-0">
                    {c.activity.map((event) => (
                      <li key={event.id} className="grid gap-0.5 px-(--card-p) py-3">
                        <span className="text-sm leading-5">{event.summary}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          <Link
                            to="/policies/$policyId"
                            params={{ policyId: event.policyId }}
                            search={{ tab: "activity" }}
                            className="font-medium hover:underline"
                          >
                            {event.policyNumber}
                          </Link>{" "}
                          · {formatRelative(event.occurredAt)}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </Panel>
            </div>
            <div className="grid gap-6">
              <Panel title="Profile">
                <dl className="m-0 grid gap-4 text-sm">
                  <Fact label="Name">{c.displayName}</Fact>
                  <Fact label="Type">{c.kind === "business" ? "Business" : "Person"}</Fact>
                  <Fact label="Email">
                    {c.emails.length === 0 ? (
                      <span className="text-muted-foreground">None on file</span>
                    ) : (
                      c.emails.map((e) => (
                        <span key={e.address} className="block truncate">
                          {e.address}
                          {e.verified && <span className="text-muted-foreground"> · verified</span>}
                        </span>
                      ))
                    )}
                  </Fact>
                  {c.phones.length > 0 && <Fact label="Phone">{c.phones.join(", ")}</Fact>}
                  {c.mailingAddress && (
                    <Fact label="Mailing address">
                      <span className="block">{c.mailingAddress.line1}</span>
                      {c.mailingAddress.line2 && (
                        <span className="block">{c.mailingAddress.line2}</span>
                      )}
                      <span className="block">
                        {c.mailingAddress.city}, {c.mailingAddress.region}{" "}
                        {c.mailingAddress.postalCode}
                      </span>
                    </Fact>
                  )}
                  <Fact label="Client since">{formatDate(c.createdAt)}</Fact>
                </dl>
              </Panel>
              <Panel title="Portal">
                <p className="m-0 text-sm">{portalState(c)}</p>
                {c.portal.map((u, i) => (
                  <p key={i} className="m-0 mt-1 text-xs text-muted-foreground">
                    {u.method === "self_claim" ? "Claimed a policy" : "Signed in by email"}{" "}
                    {formatDate(u.verifiedAt)}
                  </p>
                ))}
              </Panel>
            </div>
          </div>
        )}
      </PageBody>
      {picking && c && (
        <PickClientDialog
          excludeId={c.id}
          onCancel={() => setPicking(false)}
          onPick={(picked) => {
            setPicking(false);
            setOther(picked);
          }}
        />
      )}
      {other && c && (
        <MergeDialog
          pair={[c, other]}
          onDone={(survivorId) => {
            setOther(null);

            if (survivorId && survivorId !== c.id)
              void navigate({ to: "/clients/$clientId", params: { clientId: survivorId } });
          }}
        />
      )}
    </>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="m-0 min-w-0">{children}</dd>
    </div>
  );
}
