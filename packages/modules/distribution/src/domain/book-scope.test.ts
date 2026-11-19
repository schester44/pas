import { describe, expect, it } from "vitest";
import { asId } from "@pas/kernel";
import { bookScopeFor } from "./book-scope";

const agencies = [
  { id: asId<"Agency">("group"), parentId: null },
  { id: asId<"Agency">("branch"), parentId: asId<"Agency">("group") },
  { id: asId<"Agency">("sub-branch"), parentId: asId<"Agency">("branch") },
  { id: asId<"Agency">("other"), parentId: null },
];

const member = (agencyId: string) => [
  { agencyId: asId<"Agency">(agencyId), role: "producer" as const, primary: true },
];

describe("bookScopeFor", () => {
  it("limits a plain agent to their own production, even inside a parent agency", () => {
    expect(
      bookScopeFor({ reach: "own", userId: "u1", memberships: member("group"), agencies }),
    ).toEqual({ kind: "producer", producerId: "u1" });
  });

  it("gives an agency admin their agency and every sub-agency, but not siblings", () => {
    const scope = bookScopeFor({
      reach: "agency",
      userId: "u2",
      memberships: member("group"),
      agencies,
    });

    expect(scope.kind === "agencies" && scope.agencyIds.toSorted()).toEqual([
      "branch",
      "group",
      "sub-branch",
    ]);
  });

  it("falls back to own production for an agency admin who belongs to no agency", () => {
    expect(bookScopeFor({ reach: "agency", userId: "u3", memberships: [], agencies })).toEqual({
      kind: "producer",
      producerId: "u3",
    });
  });

  it("gives staff the tenant's whole book", () => {
    expect(
      bookScopeFor({ reach: "tenant", userId: "u4", memberships: member("other"), agencies }),
    ).toEqual({ kind: "tenant" });
  });
});
