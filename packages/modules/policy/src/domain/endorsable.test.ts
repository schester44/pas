import type { FormDefinition, RiskSchema } from "@pas/forms-core";
import { describe, expect, it } from "vitest";
import { applyEndorsableChanges } from "./endorsable";

const schema: RiskSchema = {
  fields: [
    {
      key: "note",
      kind: "text",
      label: "Underwriting note",
      endorsable: { roles: ["underwriter"] },
    },
    {
      key: "locations",
      kind: "repeatable",
      label: "Locations",
      exposure: "location",
      minItems: 1,
      maxItems: 3,
      endorsable: true,
      children: [
        { key: "address", kind: "address", label: "Address", country: "US" },
        { key: "roofAge", kind: "integer", label: "Roof age", endorsable: true },
        { key: "construction", kind: "text", label: "Construction" },
        {
          key: "sprinklered",
          kind: "boolean",
          label: "Sprinklered",
          endorsable: {
            when: 'date(transaction.effectiveDate) < date(term.effectiveDate) + duration("60d")',
            reason: "Only in the first 60 days",
          },
        },
      ],
    },
  ],
};

const form: FormDefinition = {
  key: "quote",
  title: "Quote",
  steps: [
    {
      id: "risk",
      title: "Risk",
      sections: [
        {
          id: "locations",
          repeat: "locations",
          itemLabel: "Location",
          items: [
            { path: "address", required: true },
            { path: "roofAge", required: true },
            { path: "construction", required: true },
          ],
        },
      ],
    },
  ],
};

const address = (line1: string) => ({
  line1,
  city: "Miami",
  region: "FL",
  postalCode: "33101",
  country: "US",
});

const row = (id: string, line1: string, roofAge: number) => ({
  $id: id,
  address: address(line1),
  roofAge,
  construction: "frame",
});

const issued = { locations: [row("a", "1 Main St", 5), row("b", "2 Main St", 8)] };

const options = (roles: string[] = [], effectiveDate = "2027-02-01") => ({
  context: {
    transaction: { effectiveDate },
    term: { effectiveDate: "2027-01-01", expirationDate: "2028-01-01" },
    actor: { roles },
  },
  form,
});

const apply = (proposed: Record<string, unknown>, opts = options()) =>
  applyEndorsableChanges(schema, issued, proposed, opts);

describe("applyEndorsableChanges", () => {
  it("matches rows by id, so reordering changes nothing and edits land on the right row", () => {
    const [a, b] = issued.locations;
    const { risk, changes } = apply({ locations: [{ ...b, roofAge: 12 }, a] });

    expect(risk.locations).toEqual([a, { ...b, roofAge: 12 }]);

    expect(changes).toEqual([
      {
        path: "locations[#b].roofAge",
        label: "Location 2 (2 Main St) · Roof age",
        before: 8,
        after: 12,
      },
    ]);
  });

  it("ignores fields the schema never lets change", () => {
    const [a, b] = issued.locations;

    expect(apply({ locations: [{ ...a, construction: "masonry" }, b] }).changes).toEqual([]);
  });

  it("adds a row validated in full against the intake form, and removes one", () => {
    const [a] = issued.locations;
    const added = row("c", "9 Ocean Dr", 2);
    const { risk, changes } = apply({ locations: [a, added] });

    expect(risk.locations).toEqual([a, added]);

    expect(changes.map((c) => c.label)).toEqual([
      "Location 2 (2 Main St) removed",
      "Location 2 (9 Ocean Dr) added",
    ]);

    expect(() =>
      apply({ locations: [a, { $id: "d", address: address("4 Elm"), roofAge: 1 }] }),
    ).toThrow(/Location 2 · Construction: Enter a value/);
  });

  it("keeps rows within the repeatable's limits", () => {
    expect(() => apply({ locations: [] })).toThrow(/at least 1 location/);
  });

  it("pairs a legacy proposal without row ids with the issued rows by position", () => {
    const legacy = { locations: [{ roofAge: 5 }, { roofAge: 8 }] };

    const { risk, changes } = applyEndorsableChanges(
      schema,
      legacy,
      { locations: [{ roofAge: 6 }, { roofAge: 8 }] },
      options(),
    );

    expect(risk.locations).toEqual([
      { $id: "row-1", roofAge: 6 },
      { $id: "row-2", roofAge: 8 },
    ]);

    expect(changes.map((c) => c.path)).toEqual(["locations[#row-1].roofAge"]);
  });

  it("gates fields by role", () => {
    expect(() => apply({ note: "Inspected" }, options(["agent"]))).toThrow(
      /Underwriting note: Only underwriter can change this/,
    );

    expect(apply({ note: "Inspected" }, options(["underwriter"])).changes).toHaveLength(1);
  });

  it("gates fields by date, evaluated on the issued row", () => {
    const [a, b] = issued.locations;
    const proposed = { locations: [{ ...a, sprinklered: true }, b] };

    expect(apply(proposed, options([], "2027-02-15")).risk.locations).toContainEqual({
      ...a,
      sprinklered: true,
    });

    expect(() => apply(proposed, options([], "2027-04-01"))).toThrow(/Only in the first 60 days/);
  });
});
