import { ac, isBuiltInRole, type Permission, roles as builtInRoles } from "@pas/auth/permissions";
import { type QueryClient, queryOptions, useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { authClient } from "./auth";

export const rbacKey = ["rbac"] as const;

type RoleStatements = Record<string, string[]>;

export function activeRoleQuery(organizationId: string) {
  return queryOptions({
    queryKey: [...rbacKey, organizationId, "active-role"],
    queryFn: async () => {
      const { data, error } = await authClient.organization.getActiveMemberRole();

      if (error) throw new Error(error.message ?? "Couldn't load your role.");

      return data.role;
    },
    staleTime: 5 * 60_000,
  });
}

// Null when the role lacks ac:read; usePermission then asks the server per check instead.
function customRoleDefinitionsQuery(organizationId: string, names: string[]) {
  return queryOptions({
    queryKey: [...rbacKey, organizationId, "custom-role-definitions", names],
    queryFn: async (): Promise<Record<string, RoleStatements> | null> => {
      const results = await Promise.all(
        names.map((roleName) => authClient.organization.getRole({ query: { roleName } })),
      );

      if (results.some((result) => result.error)) return null;

      return Object.fromEntries(
        results.map((result, index) => [
          names[index],
          (result.data?.permission ?? {}) as RoleStatements,
        ]),
      );
    },
    staleTime: 5 * 60_000,
  });
}

export async function prefetchAccess(queryClient: QueryClient, organizationId: string) {
  const role = await queryClient.ensureQueryData(activeRoleQuery(organizationId));

  const customNames = parseRoles(role)
    .filter((name) => !isBuiltInRole(name))
    .toSorted();

  if (customNames.length > 0) {
    await queryClient.ensureQueryData(customRoleDefinitionsQuery(organizationId, customNames));
  }
}

export function parseRoles(role: string): string[] {
  return role
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

function useActiveOrganizationId(): string {
  const { session } = useRouteContext({ from: "/_authed" });

  return session.session.activeOrganizationId ?? "";
}

export function useActiveRole(): string | undefined {
  const organizationId = useActiveOrganizationId();

  return useQuery({ ...activeRoleQuery(organizationId), enabled: !!organizationId }).data;
}

export function usePermission(permissions: Permission): boolean | undefined {
  const organizationId = useActiveOrganizationId();
  const role = useActiveRole();
  const names = role ? parseRoles(role) : [];
  const customNames = names.filter((name) => !isBuiltInRole(name)).toSorted();

  const definitions = useQuery({
    ...customRoleDefinitionsQuery(organizationId, customNames),
    enabled: customNames.length > 0,
  });

  const fallback = definitions.data === null;

  const server = useQuery({
    queryKey: [...rbacKey, organizationId, "has-permission", role, permissions],
    queryFn: async () => {
      const { data, error } = await authClient.organization.hasPermission({ permissions });

      if (error) throw new Error(error.message ?? "Couldn't check permissions.");

      return data.success;
    },
    enabled: fallback,
    staleTime: 5 * 60_000,
  });

  if (!role) return undefined;

  if (fallback) return server.data;

  if (customNames.length > 0 && !definitions.data) return undefined;

  return names.some((name) => {
    if (isBuiltInRole(name)) return builtInRoles[name].authorize(permissions).success;

    const statements = definitions.data?.[name];

    return statements ? ac.newRole(statements).authorize(permissions).success : false;
  });
}

export function useAccess() {
  const productRead = usePermission({ product: ["read"] });
  const productWrite = usePermission({ product: ["write"] });
  const productPublish = usePermission({ product: ["publish"] });
  const submissionRead = usePermission({ submission: ["read"] });
  const submissionUpdate = usePermission({ submission: ["update"] });
  const policyRead = usePermission({ policy: ["read"] });
  const policyUpdate = usePermission({ policy: ["update"] });
  const agencyRead = usePermission({ agency: ["read"] });
  const agencyWrite = usePermission({ agency: ["write"] });
  const uwApprove = usePermission({ uw: ["approve"] });
  const uwRead = usePermission({ uw: ["read"] });
  const uwOverride = usePermission({ uw: ["override"] });
  const documentRead = usePermission({ document: ["read"] });
  const documentWrite = usePermission({ document: ["write"] });
  const decisionRead = usePermission({ decision: ["read"] });
  const decisionWrite = usePermission({ decision: ["write"] });
  const ratingRead = usePermission({ rating: ["read"] });
  const ratingWrite = usePermission({ rating: ["write"] });
  const invite = usePermission({ invitation: ["create"] });
  const cancelInvite = usePermission({ invitation: ["cancel"] });
  const updateMember = usePermission({ member: ["update"] });
  const removeMember = usePermission({ member: ["delete"] });
  const createRole = usePermission({ ac: ["create"] });
  const updateRole = usePermission({ ac: ["update"] });
  const deleteRole = usePermission({ ac: ["delete"] });
  const updateOrganization = usePermission({ organization: ["update"] });
  const complianceRead = usePermission({ compliance: ["read"] });
  const complianceWrite = usePermission({ compliance: ["write"] });
  const billingRead = usePermission({ billing: ["read"] });
  const billingWrite = usePermission({ billing: ["write"] });
  const extensionRead = usePermission({ extension: ["read"] });
  const extensionWrite = usePermission({ extension: ["write"] });
  const extensionPublish = usePermission({ extension: ["publish"] });

  const members = invite || updateMember || removeMember;
  const roles = createRole || updateRole || deleteRole;

  return {
    products: { read: !!productRead, write: !!productWrite, publish: !!productPublish },
    submissions: { read: !!submissionRead, update: !!submissionUpdate },
    policies: { read: !!policyRead, update: !!policyUpdate },
    compliance: { read: !!complianceRead, write: !!complianceWrite },
    billing: { read: !!billingRead, write: !!billingWrite },
    agencies: { read: !!agencyRead, write: !!agencyWrite },
    underwriting: { read: !!uwRead, approve: !!uwApprove, configure: !!uwOverride },
    documents: { read: !!documentRead, write: !!documentWrite },
    decisions: { read: !!decisionRead, write: !!decisionWrite },
    rating: { read: !!ratingRead, write: !!ratingWrite },
    extensions: {
      read: !!extensionRead,
      write: !!extensionWrite,
      publish: !!extensionPublish,
    },
    members: {
      view: !!members,
      invite: !!invite,
      cancelInvite: !!cancelInvite,
      update: !!updateMember,
      remove: !!removeMember,
    },
    roles: { view: !!roles, create: !!createRole, update: !!updateRole, delete: !!deleteRole },
    branding: { view: true, update: !!updateOrganization },
    settings: true,
  };
}

export type Access = ReturnType<typeof useAccess>;
