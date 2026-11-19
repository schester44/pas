import { jurisdiction, Money } from "@pas/kernel";
import { describe, expect, it } from "vitest";
import { type AuthorityProfile, checkAuthority, requiredLevel } from "./authority";

const profile = (p: Partial<AuthorityProfile> & Pick<AuthorityProfile, "key" | "level">) => ({
  name: p.key,
  maxPremium: null,
  maxInsuredValue: null,
  products: [],
  jurisdictions: [],
  roles: [],
  userIds: [],
  ...p,
});

const profiles = [
  profile({ key: "underwriter", level: 1, maxPremium: "5000", roles: ["underwriter"] }),
  profile({ key: "senior_underwriter", level: 2, maxPremium: "10000" }),
  profile({ key: "chief_underwriter", level: 3, roles: ["owner"] }),
];

const request = (premium: string, authorities: string[] = ["underwriter"]) => ({
  productId: "p1",
  jurisdiction: jurisdiction("US", "US-IL"),
  writtenPremium: Money.of(premium, "USD"),
  insuredValue: Money.of("400000", "USD"),
  authorities,
});

const riley = { userId: "riley", roles: ["underwriter"] };

describe("checkAuthority", () => {
  it("approves within the underwriter's limits", () => {
    expect(checkAuthority(profiles, riley, request("4500")).ok).toBe(true);
  });

  it("escalates to the lowest level that could approve an over-limit premium", () => {
    const check = checkAuthority(profiles, riley, request("5200"));

    expect(check).toMatchObject({ ok: false, escalateTo: 2 });
  });

  it("escalates when a reason needs a higher authority than the approver holds", () => {
    const check = checkAuthority(profiles, riley, request("1000", ["senior_underwriter"]));

    expect(check).toMatchObject({ ok: false, escalateTo: 2 });
  });

  it("lets a member's direct profile outrank one held through a role", () => {
    const named = [...profiles, profile({ key: "riley", level: 3, userIds: ["riley"] })];

    expect(checkAuthority(named, riley, request("50000", ["senior_underwriter"])).ok).toBe(true);
  });

  it("treats an authority no profile defines as needing the top level", () => {
    expect(requiredLevel(profiles, ["board_approval"])).toBe(3);
  });
});
