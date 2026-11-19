import { asId, type BookScope } from "@pas/kernel";
import { type Agency, withDescendants } from "./agency";
import type { AgencyMembership } from "./producer";

/** How far a role reaches (decided by `@pas/auth`): the tenant, its agencies, or only its own production. */
export type BookReach = "tenant" | "agency" | "own";

/**
 * PLAN §5.7: staff see the tenant's book; an agency admin sees everything written through their
 * agencies and sub-agencies; everyone else sees what they produced.
 */
export function bookScopeFor(input: {
  reach: BookReach;
  userId: string;
  memberships: readonly AgencyMembership[];
  agencies: readonly Pick<Agency, "id" | "parentId">[];
}): BookScope {
  if (input.reach === "tenant") return { kind: "tenant" };

  if (input.reach === "agency" && input.memberships.length > 0) {
    const roots = input.memberships.map((m) => m.agencyId);

    return { kind: "agencies", agencyIds: withDescendants(input.agencies, roots) };
  }

  return { kind: "producer", producerId: asId(input.userId) };
}

/** Whether a scope covers an agency's records (managing its producers, reading its statements). */
export const coversAgency = (scope: BookScope, agencyId: string) =>
  scope.kind === "tenant" || (scope.kind === "agencies" && scope.agencyIds.includes(agencyId));
