import { describe, expect, it } from "vitest";
import { clientMaySee, clientScopeFor, type ScopeFacts } from "./client-scope";

const facts: ScopeFacts = {
  tenantId: "acme",
  userId: "u1",
  clientUsers: [
    { tenantId: "acme", userId: "u1", clientAccountId: "jordan" },
    { tenantId: "acme", userId: "u1", clientAccountId: "bakery" },
    { tenantId: "acme", userId: "u1", clientAccountId: "old" },
    { tenantId: "other", userId: "u1", clientAccountId: "elsewhere" },
    { tenantId: "acme", userId: "u2", clientAccountId: "riley" },
  ],
  accounts: [
    { id: "jordan", tenantId: "acme", status: "active" },
    { id: "bakery", tenantId: "acme", status: "active" },
    { id: "old", tenantId: "acme", status: "merged" },
    { id: "riley", tenantId: "acme", status: "active" },
    { id: "elsewhere", tenantId: "other", status: "active" },
  ],
  links: [
    { tenantId: "acme", policyId: "p-home", clientAccountId: "jordan", role: "named_insured" },
    { tenantId: "acme", policyId: "p-shop", clientAccountId: "bakery", role: "authorized_contact" },
    {
      tenantId: "acme",
      policyId: "p-joint",
      clientAccountId: "jordan",
      role: "additional_named_insured",
    },
    { tenantId: "acme", policyId: "p-joint", clientAccountId: "riley", role: "named_insured" },
    { tenantId: "acme", policyId: "p-bank", clientAccountId: "jordan", role: "mortgagee" },
    { tenantId: "acme", policyId: "p-stale", clientAccountId: "old", role: "named_insured" },
    { tenantId: "acme", policyId: "p-riley", clientAccountId: "riley", role: "named_insured" },
    { tenantId: "other", policyId: "p-other", clientAccountId: "elsewhere", role: "named_insured" },
  ],
};

describe("clientScopeFor", () => {
  const scope = clientScopeFor(facts);

  it("sees every policy the user's active accounts are a portal party to, across producers", () => {
    expect(scope.clientAccountIds).toEqual(["jordan", "bakery"]);
    expect(scope.policyIds.toSorted()).toEqual(["p-home", "p-joint", "p-shop"]);
  });

  it("never sees another client's policy, another tenant's, a merged account's or a non-portal role's", () => {
    for (const policyId of ["p-riley", "p-other", "p-stale", "p-bank"]) {
      expect(clientMaySee(scope, "acme", policyId)).toBe(false);
    }

    expect(clientMaySee(scope, "other", "p-home")).toBe(false);

    expect(clientMaySee(clientScopeFor({ ...facts, tenantId: "other" }), "other", "p-other")).toBe(
      true,
    );
  });

  it("is empty for a signed-in user with no linked accounts", () => {
    expect(clientScopeFor({ ...facts, userId: "nobody" }).policyIds).toEqual([]);
  });
});
