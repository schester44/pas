import { createPlatformClient, platformTrpc } from "@pas/api-client";
import { EmptyState } from "@pas/ui/components/empty-state";
import { Notice } from "@pas/ui/components/notice";
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
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Building2 } from "lucide-react";
import { formatDate } from "@/lib/format";
import { queryClient } from "@/lib/trpc";

const platformClient = createPlatformClient();
const { TRPCProvider: PlatformTRPCProvider, useTRPC: usePlatformTRPC } = platformTrpc;

export const Route = createFileRoute("/_authed/platform/tenants")({
  beforeLoad: ({ context }) => {
    if (context.session.user.role !== "admin") throw redirect({ to: "/" });
  },
  component: () => (
    <PlatformTRPCProvider trpcClient={platformClient} queryClient={queryClient}>
      <TenantsPage />
    </PlatformTRPCProvider>
  ),
});

type Tenant = {
  tenantId: string;
  name: string;
  slug: string;
  appSubdomain: string;
  customDomains: string[];
  primaryColor: string;
  memberCount: number;
  createdAt: string;
};

function TenantsPage() {
  const trpc = usePlatformTRPC();
  const tenants = useQuery(trpc.tenants.list.queryOptions());

  return (
    <>
      <PageHeader title="Tenants" />
      <PageBody className="max-w-6xl">
        {tenants.error ? (
          <Notice tone="error" title="Couldn't load tenants">
            {tenants.error.message}
          </Notice>
        ) : (
          <Panel flush>
            {tenants.data?.length === 0 ? (
              <EmptyState icon={<Building2 />} title="No tenants yet" />
            ) : (
              <>
                <TenantsTable tenants={tenants.data} />
                <TenantsList tenants={tenants.data} />
              </>
            )}
          </Panel>
        )}
      </PageBody>
    </>
  );
}

function TenantsTable({ tenants }: { tenants: Tenant[] | undefined }) {
  return (
    <div className="hidden lg:block">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tenant</TableHead>
            <TableHead>Domains</TableHead>
            <TableHead className="text-right">Members</TableHead>
            <TableHead className="text-right">Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {!tenants &&
            Array.from({ length: 3 }, (_, i) => (
              <TableRow key={i}>
                <TableCell colSpan={4}>
                  <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
                </TableCell>
              </TableRow>
            ))}
          {tenants?.map((tenant) => (
            <TableRow key={tenant.tenantId}>
              <TableCell>
                <TenantName tenant={tenant} />
              </TableCell>
              <TableCell>
                <Domains tenant={tenant} />
              </TableCell>
              <TableCell className="text-right tabular-nums">{tenant.memberCount}</TableCell>
              <TableCell className="text-right text-muted-foreground tabular-nums">
                {formatDate(tenant.createdAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function TenantsList({ tenants }: { tenants: Tenant[] | undefined }) {
  return (
    <ul className="m-0 grid list-none divide-y p-0 lg:hidden">
      {tenants?.map((tenant) => (
        <li key={tenant.tenantId} className="grid gap-2 px-(--card-p) py-4">
          <TenantName tenant={tenant} />
          <Domains tenant={tenant} />
          <p className="m-0 text-xs text-muted-foreground tabular-nums">
            {tenant.memberCount} {tenant.memberCount === 1 ? "member" : "members"} · Created{" "}
            {formatDate(tenant.createdAt)}
          </p>
        </li>
      ))}
    </ul>
  );
}

function TenantName({ tenant }: { tenant: Tenant }) {
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden
        className="size-2.5 shrink-0 rounded-full ring-1 ring-black/10"
        style={{ background: tenant.primaryColor }}
      />
      <div className="grid min-w-0 gap-0.5">
        <span className="truncate font-medium">{tenant.name}</span>
        <span className="truncate font-mono text-xs text-muted-foreground">{tenant.slug}</span>
      </div>
    </div>
  );
}

function Domains({ tenant }: { tenant: Tenant }) {
  const [first, ...rest] = tenant.customDomains;

  return (
    <div className="grid min-w-0 gap-0.5 text-sm">
      <span className="truncate">{tenant.appSubdomain}</span>
      {first && (
        <span className="truncate text-xs text-muted-foreground">
          {first}
          {rest.length > 0 && ` +${rest.length} more`}
        </span>
      )}
    </div>
  );
}
