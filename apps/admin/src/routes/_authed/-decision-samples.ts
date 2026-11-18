import type { DecisionKind, DecisionTableContent, JdmDecision } from "@pas/decisions-engine";
import type { RiskSchema } from "@pas/forms-core";
import { tableDecision } from "@/components/decisions/jdm-edit";

export const homeownersSchema: RiskSchema = {
  fields: [
    {
      key: "jurisdiction",
      kind: "group",
      label: "Jurisdiction",
      children: [
        {
          key: "country",
          kind: "enum",
          label: "Country",
          options: [{ value: "US", label: "United States" }],
        },
        {
          key: "subdivision",
          kind: "enum",
          label: "State",
          options: [
            { value: "US-IL", label: "Illinois" },
            { value: "US-IN", label: "Indiana" },
          ],
        },
      ],
    },
    {
      key: "placement",
      kind: "group",
      label: "Placement",
      children: [
        {
          key: "market",
          kind: "enum",
          label: "Market",
          options: [
            { value: "admitted", label: "Admitted" },
            { value: "non_admitted", label: "Non-admitted" },
          ],
        },
      ],
    },
    {
      key: "insured",
      kind: "group",
      label: "Named insured",
      children: [
        { key: "exemptCommercialPurchaser", kind: "boolean", label: "Exempt commercial purchaser" },
      ],
    },
    {
      key: "property",
      kind: "group",
      label: "Property",
      children: [
        { key: "roofAge", kind: "integer", label: "Roof age" },
        { key: "coastalCounty", kind: "boolean", label: "Coastal county" },
        { key: "distanceToCoast", kind: "number", label: "Distance to coast (mi)" },
        { key: "protectionClass", kind: "integer", label: "Protection class" },
      ],
    },
    { key: "priorClaims", kind: "integer", label: "Claims in the last 5 years" },
  ],
};

const column = (id: string, name: string, field: string) => ({ id, name, field });

const rows = (
  columns: string[],
  values: (string | undefined)[][],
  descriptions: string[],
): DecisionTableContent["rules"] =>
  values.map((cells, i) => ({
    _id: `r${i + 1}`,
    _description: descriptions[i],
    ...Object.fromEntries(columns.map((id, c) => [id, cells[c] ?? ""])),
  }));

const underwriting: DecisionTableContent = {
  hitPolicy: "collect",
  inputs: [
    column("roof", "Roof age", "property.roofAge"),
    column("coastal", "Coastal county", "property.coastalCounty"),
    column("coast", "Distance to coast", "property.distanceToCoast"),
    column("pc", "Protection class", "property.protectionClass"),
    column("claims", "Prior claims", "priorClaims"),
  ],
  outputs: [
    column("outcome", "Outcome", "outcome"),
    column("reason", "Reason code", "reasonCode"),
    column("message", "Message", "message"),
    column("authority", "Authority", "authority"),
  ],
  rules: rows(
    ["roof", "coastal", "coast", "pc", "claims", "outcome", "reason", "message", "authority"],
    [
      ["> 30", "", "", "", "", '"decline"', '"ROOF_AGE_MAX"', '"Roof is older than 30 years"'],
      [
        "[21..30]",
        "true",
        "",
        "",
        "",
        '"refer"',
        '"ROOF_AGE_COASTAL"',
        '"Roof older than 20 years in a coastal county"',
        '"senior_underwriter"',
      ],
      ["", "", "< 1", "", "", '"decline"', '"COAST_DISTANCE"', '"Within 1 mile of the coast"'],
      [
        "",
        "",
        "[1..5)",
        "",
        "",
        '"refer"',
        '"COAST_DISTANCE_REVIEW"',
        '"Within 5 miles of the coast"',
        '"underwriter"',
      ],
      [
        "",
        "",
        "",
        ">= 9",
        "",
        '"refer"',
        '"PROTECTION_CLASS"',
        '"Protection class 9 or 10"',
        '"underwriter"',
      ],
      [
        "",
        "",
        "",
        "",
        ">= 3",
        '"decline"',
        '"PRIOR_CLAIMS"',
        '"Three or more claims in the last 5 years"',
      ],
      [
        "",
        "",
        "",
        "",
        "[1..2]",
        '"info_needed"',
        '"CLAIMS_DETAIL"',
        '"Tell us about the prior claims"',
      ],
    ],
    [
      "Outside appetite",
      "Wind exposure on an aging roof",
      "Coastal moratorium band",
      "Needs a wind mitigation review",
      "Weak fire protection",
      "Loss frequency",
      "Ask for dates, causes and amounts",
    ],
  ),
};

const taxesFees: DecisionTableContent = {
  hitPolicy: "collect",
  inputs: [
    column("state", "State", "jurisdiction.subdivision"),
    column("market", "Market", "placement.market"),
  ],
  outputs: [
    column("code", "Code", "code"),
    column("label", "Label", "label"),
    column("rate", "Rate", "rate"),
    column("basis", "Basis", "basis"),
    column("taxable", "Taxable", "taxable"),
    column("remitter", "Remitter", "remitter"),
  ],
  rules: rows(
    ["state", "market", "code", "label", "rate", "basis", "taxable", "remitter"],
    [
      ['"US-IL"', '"non_admitted"', '"IL_SL_TAX"', '"Surplus lines tax"', "0.035"],
      ['"US-IL"', '"non_admitted"', '"IL_STAMPING_FEE"', '"Stamping fee"', "0.0004"],
      ['"US-IL"', '"non_admitted"', '"IL_FIRE_MARSHAL_TAX"', '"Fire marshal tax"', "0.01"],
      ['"US-IN"', '"non_admitted"', '"IN_SL_TAX"', '"Surplus lines tax"', "0.025"],
    ].map((cells) => [...cells, '"premium"', "false", '"licensee"']),
    [
      "Home state premium tax",
      "Paid to the stamping office",
      "State fire marshal",
      "Home state premium tax",
    ],
  ),
};

const dea: DecisionTableContent = {
  hitPolicy: "first",
  inputs: [
    column("state", "State", "jurisdiction.subdivision"),
    column("market", "Market", "placement.market"),
    column("ecp", "Exempt commercial purchaser", "insured.exemptCommercialPurchaser"),
  ],
  outputs: [
    column("required", "Required", "required"),
    column("declinations", "Declinations", "declinationsRequired"),
    column("timing", "Timing", "timing"),
    column("exemptions", "Exemptions", "exemptions"),
  ],
  rules: rows(
    ["state", "market", "ecp", "required", "declinations", "timing", "exemptions"],
    [
      ["", '"admitted"', "", "false", "0", "", "[]"],
      ['"US-IL"', '"non_admitted"', "true", "false", "0", "", '["exempt_commercial_purchaser"]'],
      ['"US-IL"', '"non_admitted"', "", "true", "3", '"post_bind"', "[]"],
      ['"US-IN"', '"non_admitted"', "", "true", "3", '"pre_bind"', "[]"],
    ],
    [
      "Admitted business needs no search",
      "Exempt commercial purchasers skip the search",
      "Affidavit filed after binding",
      "Declinations collected before binding",
    ],
  ),
};

export interface DecisionSample {
  id: string;
  label: string;
  kind: DecisionKind;
  decision: JdmDecision;
  sample: Record<string, unknown>;
}

export const decisionSamples: DecisionSample[] = [
  {
    id: "underwriting",
    label: "Underwriting",
    kind: "underwriting",
    decision: tableDecision("Homeowners underwriting rules", underwriting),
    sample: {
      property: { roofAge: 24, coastalCounty: true, distanceToCoast: 8, protectionClass: 4 },
      priorClaims: 0,
    },
  },
  {
    id: "taxes",
    label: "Taxes and fees",
    kind: "taxes_fees",
    decision: tableDecision("Surplus lines taxes and fees", taxesFees),
    sample: { jurisdiction: { subdivision: "US-IL" }, placement: { market: "non_admitted" } },
  },
  {
    id: "dea",
    label: "Diligent search",
    kind: "dea",
    decision: tableDecision("Diligent search requirements", dea),
    sample: {
      jurisdiction: { subdivision: "US-IN" },
      placement: { market: "non_admitted" },
      insured: { exemptCommercialPurchaser: false },
    },
  },
];
