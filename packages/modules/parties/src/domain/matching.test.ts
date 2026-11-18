import { describe, expect, it } from "vitest";
import { contactKeys, emailKey } from "./contact";
import { type MatchCandidate, matchClientAccount } from "./matching";

const address = {
  line1: "1420 Elmwood Avenue",
  city: "Evanston",
  region: "IL",
  postalCode: "60201-1234",
  country: "US",
};

const account = (id: string, contact: Parameters<typeof contactKeys>[0]): MatchCandidate => ({
  id,
  ...contactKeys(contact),
});

describe("matchClientAccount", () => {
  const jordan = account("a1", {
    kind: "person",
    name: "Jordan Avery",
    email: "Jordan.Avery@Gmail.com",
    phone: "(312) 555-0100",
    mailingAddress: address,
  });

  it("matches on a normalized email, whatever the name says", () => {
    expect(emailKey("j.o.r.d.a.n.avery+home@googlemail.com")).toBe(
      emailKey("jordanavery@gmail.com"),
    );

    const match = matchClientAccount(
      contactKeys({ kind: "person", name: "J. Avery", email: " jordan.avery+policies@gmail.com " }),
      [jordan],
    );

    expect(match).toEqual({ accountId: "a1", reason: "email" });
  });

  it("matches the same name with a shared phone or address, never a name alone", () => {
    expect(
      matchClientAccount(
        contactKeys({ kind: "person", name: "Avery, Jordan", phone: "+1 312 555 0100" }),
        [jordan],
      ),
    ).toEqual({ accountId: "a1", reason: "name_and_phone" });

    expect(
      matchClientAccount(
        contactKeys({
          kind: "person",
          name: "Jordan Avery",
          mailingAddress: { ...address, line1: "1420 Elmwood Ave.", postalCode: "60201" },
        }),
        [jordan],
      ),
    ).toEqual({ accountId: "a1", reason: "name_and_address" });

    expect(
      matchClientAccount(contactKeys({ kind: "person", name: "Jordan Avery" }), [jordan]),
    ).toBeNull();
  });

  it("keeps two different emails at one address apart, and people apart from businesses", () => {
    expect(
      matchClientAccount(
        contactKeys({
          kind: "person",
          name: "Jordan Avery",
          email: "jr@example.com",
          mailingAddress: address,
        }),
        [jordan],
      ),
    ).toBeNull();

    expect(
      matchClientAccount(
        contactKeys({ kind: "business", name: "Jordan Avery", email: "jordan.avery@gmail.com" }),
        [jordan],
      ),
    ).toBeNull();
  });

  it("folds business suffixes and picks the oldest of several matches", () => {
    const older = account("b1", {
      kind: "business",
      name: "Lakeshore Bakery, LLC",
      phone: "312-555-0199",
    });

    const newer = account("b2", {
      kind: "business",
      name: "Lakeshore Bakery Inc",
      phone: "312-555-0199",
    });

    expect(
      matchClientAccount(
        contactKeys({ kind: "business", name: "lakeshore bakery", phone: "3125550199" }),
        [older, newer],
      ),
    ).toEqual({ accountId: "b1", reason: "name_and_phone" });
  });
});
