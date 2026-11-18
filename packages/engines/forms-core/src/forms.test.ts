import { describe, expect, it } from "vitest";
import type { FormDefinition } from "./form";
import { checkReferences } from "./references";
import type { RiskSchema } from "./schema";
import { evaluateForm, validateSubmission } from "./index";

const schema: RiskSchema = {
  fields: [
    {
      key: "insured",
      kind: "group",
      label: "Insured",
      children: [
        { key: "name", kind: "text", label: "Name", pii: true },
        { key: "birthDate", kind: "date", label: "Date of birth" },
      ],
    },
    { key: "priorClaims", kind: "integer", label: "Prior claims" },
    { key: "claimsDescription", kind: "text", label: "Describe the claims" },
    { key: "claimsFollowUp", kind: "text", label: "Follow-up" },
    {
      key: "locations",
      kind: "repeatable",
      label: "Locations",
      exposure: "location",
      minItems: 1,
      children: [
        { key: "yearBuilt", kind: "integer", label: "Year built" },
        { key: "dwellingLimit", kind: "money", label: "Dwelling limit" },
        { key: "rewired", kind: "boolean", label: "Rewired" },
      ],
    },
  ],
};

const form: FormDefinition = {
  key: "quote",
  title: "Quote",
  steps: [
    {
      id: "applicant",
      title: "Applicant",
      sections: [
        {
          id: "insured",
          items: [
            { path: "insured.name", required: true },
            { path: "insured.birthDate" },
            { path: "priorClaims", required: true },
            { path: "claimsDescription", visibleWhen: "priorClaims > 0", required: true },
            { path: "claimsFollowUp", visibleWhen: "claimsDescription != null", required: true },
          ],
        },
      ],
    },
    {
      id: "property",
      title: "Property",
      sections: [
        {
          id: "locations",
          repeat: "locations",
          items: [
            {
              path: "yearBuilt",
              required: true,
              validations: [{ expression: "$item.yearBuilt >= 1800", message: "Too old" }],
            },
            { path: "dwellingLimit", requiredWhen: "$index == 0" },
            { path: "rewired", visibleWhen: "$item.yearBuilt < 1950", required: true },
          ],
        },
      ],
    },
  ],
};

describe("form evaluation", () => {
  it("reports required fields only when visible", () => {
    const state = evaluateForm(schema, form, { priorClaims: 0, locations: [{}] });
    expect(state.items["insured.name"]).toMatchObject({ visible: true, errors: ["Enter a value"] });

    expect(state.items.claimsDescription).toMatchObject({
      visible: false,
      required: false,
      errors: [],
    });

    expect(state.items["locations[0].dwellingLimit"]).toMatchObject({ required: true });
    expect(state.items["locations[0].rewired"]?.visible).toBe(false);
    expect(state.valid).toBe(false);
  });

  it("cascades hidden values to dependent fields", () => {
    const data = { priorClaims: 0, claimsDescription: "Hail", claimsFollowUp: "Paid" };
    const state = evaluateForm(schema, form, data);
    expect(state.items.claimsDescription?.visible).toBe(false);
    expect(state.items.claimsFollowUp?.visible).toBe(false);
  });

  it("evaluates the current repeatable item", () => {
    const data = { locations: [{ yearBuilt: 1700 }, { yearBuilt: 1940 }] };
    const state = evaluateForm(schema, form, data);
    expect(state.items["locations[0].yearBuilt"]?.errors).toEqual(["Too old"]);
    expect(state.items["locations[1].rewired"]).toMatchObject({ visible: true, required: true });
    expect(state.items["locations[1].dwellingLimit"]?.required).toBe(false);
  });

  it("enforces repeatable item counts", () => {
    const state = evaluateForm(schema, form, { locations: [] });
    expect(state.steps[1]?.sections[0]?.errors).toEqual(["Add at least one entry"]);
  });

  it("coerces a submission and drops hidden values", () => {
    const result = validateSubmission(schema, form, {
      insured: { name: "  Dana Reyes ", birthDate: "1980-02-29" },
      priorClaims: "0",
      claimsDescription: "Should be dropped",
      unknown: "dropped",
      locations: [{ yearBuilt: 1990, dwellingLimit: "450,000.5", rewired: true }],
    });

    expect(result.ok).toBe(true);

    expect(result.data).toEqual({
      insured: { name: "Dana Reyes", birthDate: "1980-02-29" },
      priorClaims: 0,
      locations: [{ yearBuilt: 1990, dwellingLimit: "450000.50" }],
    });
  });

  it("rejects malformed values", () => {
    const result = validateSubmission(schema, form, {
      insured: { name: "A", birthDate: "1981-02-29" },
      priorClaims: 1.5,
      locations: [{ yearBuilt: 2000, dwellingLimit: "10.001" }],
    });

    expect(result.ok).toBe(false);

    expect(result.errors).toEqual({
      "insured.birthDate": ["Enter a date as YYYY-MM-DD"],
      priorClaims: ["Enter a whole number"],
      "locations[0].dwellingLimit": ["Enter an amount with up to 2 decimals"],
    });
  });

  it("checks references", () => {
    const broken: FormDefinition = {
      key: "broken",
      title: "Broken",
      steps: [
        {
          id: "one",
          title: "One",
          sections: [
            {
              id: "a",
              items: [
                { path: "insured", visibleWhen: "insured.age > 1" },
                { path: "locations[].yearBuilt" },
                { path: "priorClaims", widget: "select", requiredWhen: "$item.x" },
              ],
            },
          ],
        },
      ],
    };

    expect(checkReferences(schema, form)).toEqual([]);

    expect(checkReferences(schema, broken).map((issue) => issue.message)).toEqual([
      "insured is a group, not a field",
      "Unknown path insured.age",
      "locations[].yearBuilt is inside a repeatable; bind it in a repeating section",
      "The select widget doesn't fit integer fields",
      "Unknown path $item.x",
    ]);
  });
});
