import { queryOptions } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { authClient } from "./auth";

export async function unwrap<T>(
  promise: Promise<{ data: T | null; error: { message?: string } | null }>,
  fallback: string,
): Promise<T> {
  const { data, error } = await promise;

  if (error || data === null) throw new Error(error?.message || fallback);

  return data;
}

export function organizationKey(organizationId: string) {
  return ["organization", organizationId] as const;
}

function fetchMembers() {
  return unwrap(
    authClient.organization.listMembers({
      query: { limit: 500, sortBy: "createdAt", sortDirection: "asc" },
    }),
    "Couldn't load members.",
  );
}

async function fetchPendingInvitations() {
  const invitations = await unwrap(
    authClient.organization.listInvitations(),
    "Couldn't load invitations.",
  );

  const now = Date.now();

  return invitations
    .filter(
      (invitation) =>
        invitation.status === "pending" && new Date(invitation.expiresAt).getTime() > now,
    )
    .toSorted((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export type Member = Awaited<ReturnType<typeof fetchMembers>>["members"][number];
export type Invitation = Awaited<ReturnType<typeof fetchPendingInvitations>>[number];

export function membersQuery(organizationId: string) {
  return queryOptions({
    queryKey: [...organizationKey(organizationId), "members"],
    queryFn: fetchMembers,
  });
}

export function invitationsQuery(organizationId: string) {
  return queryOptions({
    queryKey: [...organizationKey(organizationId), "invitations"],
    queryFn: fetchPendingInvitations,
  });
}

export interface CustomRole {
  id: string;
  role: string;
  permission: Record<string, string[]>;
  createdAt: Date | string;
}

export function customRolesQuery(organizationId: string) {
  return queryOptions({
    queryKey: [...organizationKey(organizationId), "roles"],
    queryFn: async () => {
      const roles = await unwrap(
        authClient.organization.listRoles(),
        "Couldn't load custom roles.",
      );

      return (roles as unknown as CustomRole[]).toSorted((a, b) => a.role.localeCompare(b.role));
    },
  });
}

export function useOrganizationId(): string {
  const { session } = useRouteContext({ from: "/_authed" });

  return session.session.activeOrganizationId ?? "";
}

export function useCurrentUserId(): string {
  const { session } = useRouteContext({ from: "/_authed" });

  return session.user.id;
}

export function inviteLink(invitationId: string): string {
  return `${window.location.origin}/accept-invitation/${invitationId}`;
}
