import { isBuiltInRole, roles } from "@pas/auth/permissions";
import { EmptyState } from "@pas/ui/components/empty-state";
import { PageBody } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import type { RoleStatements } from "@/components/permission-matrix";
import { BuiltInRoleView, RoleEditor, RoleHeader } from "@/components/role-editor";
import { customRolesQuery, useOrganizationId } from "@/lib/organization";

export const Route = createFileRoute("/_authed/settings/roles/$role")({
  component: RolePage,
});

function RolePage() {
  const { role } = Route.useParams();

  if (isBuiltInRole(role)) {
    return <BuiltInRoleView role={role} statements={toRoleStatements(roles[role].statements)} />;
  }

  return <CustomRolePage role={role} />;
}

function toRoleStatements(statements: Record<string, readonly string[]>): RoleStatements {
  return Object.fromEntries(
    Object.entries(statements).map(([key, actions]) => [key, [...actions]]),
  );
}

function CustomRolePage({ role }: { role: string }) {
  const organizationId = useOrganizationId();
  const custom = useQuery(customRolesQuery(organizationId));
  const existing = custom.data?.find((candidate) => candidate.role === role);

  if (existing) return <RoleEditor key={existing.id} existing={existing} />;

  return (
    <>
      <RoleHeader title={custom.isPending ? "" : "Not found"} />
      <PageBody className="max-w-4xl">
        <Panel flush>
          {custom.isPending ? (
            <div className="h-40" />
          ) : (
            <EmptyState
              icon={<ShieldCheck />}
              title="This role doesn't exist"
              description="It may have been deleted. Go back to roles to pick another."
            />
          )}
        </Panel>
      </PageBody>
    </>
  );
}
