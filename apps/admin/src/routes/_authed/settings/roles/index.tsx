import { builtInRoleLabels, builtInRoleOrder, roleLabel } from "@pas/auth/permissions";
import { Button } from "@pas/ui/components/button";
import { EmptyState } from "@pas/ui/components/empty-state";
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, Plus, ShieldCheck } from "lucide-react";
import type * as React from "react";
import { countPermissions } from "@/components/permission-matrix";
import { customRolesQuery, membersQuery, useOrganizationId } from "@/lib/organization";
import { parseRoles, useAccess } from "@/lib/permissions";

export const Route = createFileRoute("/_authed/settings/roles/")({
  component: RolesPage,
});

function RolesPage() {
  const access = useAccess();
  const organizationId = useOrganizationId();
  const custom = useQuery(customRolesQuery(organizationId));
  const memberCounts = useMemberCountsByRole();

  return (
    <>
      <PageHeader
        title="Roles"
        actions={
          access.roles.create && (
            <Button size="sm" asChild>
              <Link to="/settings/roles/new">
                <Plus /> New role
              </Link>
            </Button>
          )
        }
      />
      <PageBody className="max-w-4xl">
        <Panel
          title="Custom roles"
          description="Roles your organization defined for how your team works."
          flush
        >
          {custom.isPending ? (
            <RoleRowSkeleton />
          ) : custom.error ? (
            <EmptyState
              icon={<ShieldCheck />}
              title="Couldn't load custom roles"
              description="Refresh the page to try again."
            />
          ) : custom.data.length === 0 ? (
            <EmptyState
              icon={<ShieldCheck />}
              title="No custom roles yet"
              description="Create one when none of the built-in roles fit."
            />
          ) : (
            <ul className="m-0 list-none divide-y p-0">
              {custom.data.map((role) => (
                <RoleRow
                  key={role.id}
                  role={role.role}
                  title={roleLabel(role.role)}
                  description={`${countPermissions(role.permission)} permissions`}
                  members={memberCounts.get(role.role)}
                />
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Built-in roles" description="Included with PAS. They can't be changed." flush>
          <ul className="m-0 list-none divide-y p-0">
            {builtInRoleOrder.map((role) => (
              <RoleRow
                key={role}
                role={role}
                title={builtInRoleLabels[role].label}
                description={builtInRoleLabels[role].description}
                members={memberCounts.get(role)}
              />
            ))}
          </ul>
        </Panel>
      </PageBody>
    </>
  );
}

function useMemberCountsByRole(): Map<string, number> {
  const organizationId = useOrganizationId();
  const members = useQuery(membersQuery(organizationId));
  const counts = new Map<string, number>();

  for (const member of members.data?.members ?? []) {
    for (const role of parseRoles(member.role)) counts.set(role, (counts.get(role) ?? 0) + 1);
  }

  return counts;
}

function RoleRow({
  role,
  title,
  description,
  members = 0,
}: {
  role: string;
  title: string;
  description: React.ReactNode;
  members?: number;
}) {
  return (
    <li>
      <Link
        to="/settings/roles/$role"
        params={{ role }}
        className="flex min-h-15 items-center gap-4 px-(--card-p) py-3 transition-colors hover:bg-muted/40"
      >
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="text-sm leading-5 font-medium">{title}</span>
          <span className="truncate text-sm text-muted-foreground">{description}</span>
        </span>
        <span className="hidden shrink-0 text-sm text-muted-foreground tabular-nums sm:block">
          {members === 0 ? "No members" : members === 1 ? "1 member" : `${members} members`}
        </span>
        <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  );
}

function RoleRowSkeleton() {
  return (
    <div className="flex min-h-15 items-center px-(--card-p) py-3">
      <span className="grid gap-1.5">
        <span className="h-3.5 w-28 animate-pulse rounded bg-muted" />
        <span className="h-3 w-40 animate-pulse rounded bg-muted" />
      </span>
    </div>
  );
}
