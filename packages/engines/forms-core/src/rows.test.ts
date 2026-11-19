import { describe, expect, it } from "vitest";
import { canonicalPath, getAt, setAt } from "./paths";
import { legacyRowId, withRowIds } from "./rows";
import type { RiskSchema } from "./schema";
import { validateSubmission } from "./submit";

const schema: RiskSchema = {
  fields: [
    {
      key: "locations",
      kind: "repeatable",
      label: "Locations",
      children: [{ key: "roofAge", kind: "integer", label: "Roof age" }],
    },
  ],
};

describe("row ids", () => {
  const risk = {
    locations: [
      { $id: "a", roofAge: 5 },
      { $id: "b", roofAge: 9 },
    ],
  };

  it("addresses rows by id in paths", () => {
    expect(getAt(risk, "locations[#b].roofAge")).toBe(9);
    expect(setAt(risk, "locations[#a].roofAge", 7).locations[0]).toEqual({ $id: "a", roofAge: 7 });
    expect(setAt(risk, "locations[#gone].roofAge", 7)).toBe(risk);
    expect(canonicalPath("locations[#b].roofAge")).toBe("locations[].roofAge");
  });

  it("keeps ids, derives legacy ones from position and leaves complete data untouched", () => {
    expect(withRowIds(schema, risk)).toBe(risk);

    const legacy = withRowIds<{ locations: { $id?: string; roofAge: number }[] }>(
      schema,
      { locations: [{ roofAge: 1 }, { roofAge: 2 }] },
      legacyRowId,
    );

    expect(legacy.locations.map((r) => r.$id)).toEqual(["row-1", "row-2"]);
    expect(withRowIds(schema, legacy, legacyRowId)).toBe(legacy);
  });

  it("survives validation", () => {
    const form = {
      key: "f",
      title: "F",
      steps: [
        {
          id: "s",
          title: "S",
          sections: [{ id: "l", repeat: "locations", items: [{ path: "roofAge" }] }],
        },
      ],
    };

    expect(validateSubmission(schema, form, risk).data).toEqual(risk);
  });
});
