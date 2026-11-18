export const PARTY_ROLES = [
  "named_insured",
  "additional_named_insured",
  "authorized_contact",
] as const;

export type PartyRole = (typeof PARTY_ROLES)[number];

/** Roles that open a policy in the portal. Future roles (e.g. mortgagee) won't, by default. */
const PORTAL_ROLES: ReadonlySet<string> = new Set<PartyRole>(PARTY_ROLES);

/** ABAC for clients (PLAN §5.7, §7.7): the policies this user may see in this tenant. */
export interface ClientScope {
  readonly kind: "client";
  readonly tenantId: string;
  readonly userId: string;
  readonly clientAccountIds: readonly string[];
  readonly policyIds: readonly string[];
}

export interface ScopeFacts {
  tenantId: string;
  userId: string;
  clientUsers: readonly { tenantId: string; userId: string; clientAccountId: string }[];
  accounts: readonly { id: string; tenantId: string; status: "active" | "merged" }[];
  links: readonly { tenantId: string; policyId: string; clientAccountId: string; role: string }[];
}

export function clientScopeFor(facts: ScopeFacts): ClientScope {
  const active = new Set(
    facts.accounts
      .filter((a) => a.tenantId === facts.tenantId && a.status === "active")
      .map((a) => a.id),
  );

  const accountIds = [
    ...new Set(
      facts.clientUsers
        .filter((u) => u.tenantId === facts.tenantId && u.userId === facts.userId)
        .map((u) => u.clientAccountId)
        .filter((id) => active.has(id)),
    ),
  ];

  const policyIds = [
    ...new Set(
      facts.links
        .filter(
          (l) =>
            l.tenantId === facts.tenantId &&
            accountIds.includes(l.clientAccountId) &&
            PORTAL_ROLES.has(l.role),
        )
        .map((l) => l.policyId),
    ),
  ];

  return {
    kind: "client",
    tenantId: facts.tenantId,
    userId: facts.userId,
    clientAccountIds: accountIds,
    policyIds,
  };
}

export function clientMaySee(scope: ClientScope, tenantId: string, policyId: string): boolean {
  return scope.tenantId === tenantId && scope.policyIds.includes(policyId);
}
