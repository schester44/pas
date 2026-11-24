const money = (amount: number) => ({ kind: "money", amount: String(amount), currency: "USD" });
const percent = (value: number) => ({ kind: "percent", value: String(value) });

/** A coverage option set from plain dollar amounts or percentages, with the default picked by value. */
export const dollars = (values: readonly number[], selected: number) => ({
  options: values.map(money),
  defaultIndex: Math.max(0, values.indexOf(selected)),
});

export const percents = (values: readonly number[], selected: number) => ({
  options: values.map(percent),
  defaultIndex: Math.max(0, values.indexOf(selected)),
});

const option = (label: string, value: string) => ({ label, value });

export const choices = (pairs: Record<string, string>) =>
  Object.entries(pairs).map(([value, label]) => option(label, value));

export const field = {
  text: (key: string, label: string, extra: Record<string, unknown> = {}) => ({
    key,
    kind: "text",
    label,
    ...extra,
  }),
  email: (key: string, label: string, extra: Record<string, unknown> = {}) => ({
    key,
    kind: "email",
    label,
    ...extra,
  }),
  integer: (key: string, label: string, extra: Record<string, unknown> = {}) => ({
    key,
    kind: "integer",
    label,
    ...extra,
  }),
  number: (key: string, label: string, extra: Record<string, unknown> = {}) => ({
    key,
    kind: "number",
    label,
    ...extra,
  }),
  boolean: (key: string, label: string, extra: Record<string, unknown> = {}) => ({
    key,
    kind: "boolean",
    label,
    ...extra,
  }),
  money: (key: string, label: string) => ({ key, kind: "money", label, currency: "USD" }),
  address: (key: string, label: string, extra: Record<string, unknown> = {}) => ({
    key,
    kind: "address",
    label,
    country: "US",
    ...extra,
  }),
  choice: (key: string, label: string, options: Record<string, string>) => ({
    key,
    kind: "enum",
    label,
    options: choices(options),
  }),
  group: (key: string, label: string, children: unknown[]) => ({
    key,
    kind: "group",
    label,
    children,
  }),
};

export const CONSTRUCTION = {
  frame: "Frame",
  masonry_veneer: "Masonry veneer",
  masonry: "Masonry",
  superior: "Fire resistive",
};

export const insuredGroup = (entityTypes: Record<string, string>) =>
  field.group("insured", "Named insured", [
    field.choice("entityType", "Named insured is", entityTypes),
    field.text("firstName", "First name", { pii: true }),
    field.text("lastName", "Last name", { pii: true }),
    field.text("businessName", "Entity name", { pii: true }),
    field.email("email", "Email", { pii: true, endorsable: true }),
    field.text("phone", "Phone", { pii: true, endorsable: true }),
  ]);

export const mailingAddress = field.address("mailingAddress", "Mailing address", {
  pii: true,
  endorsable: true,
});

/** Hazard and replacement cost prefill from the data vendors, falling back to the mock vendor. */
export const ENRICHMENT = {
  stages: {
    pre_rate: [
      {
        id: "hazards",
        capability: "hazard_scores",
        providers: ["hazardhub", "mock_data"],
        combine: "fallback",
        request: {
          street: "locations[0].address.line1",
          city: "locations[0].address.city",
          state: "locations[0].address.region",
          postalCode: "locations[0].address.postalCode",
        },
        optional: [],
        response: {},
        mode: "prefill",
        cacheTtl: "P30D",
        costClass: "medium",
        dependsOn: [],
        timeoutMs: 5000,
        fieldSources: {},
      },
      {
        id: "rce",
        capability: "replacement_cost",
        providers: ["e2value", "mock_data"],
        combine: "fallback",
        request: {
          street: "locations[0].address.line1",
          city: "locations[0].address.city",
          state: "locations[0].address.region",
          postalCode: "locations[0].address.postalCode",
          yearBuilt: "locations[0].yearBuilt",
          squareFeet: "locations[0].squareFeet",
        },
        optional: ["yearBuilt", "squareFeet"],
        response: {},
        mode: "prefill",
        cacheTtl: "P30D",
        costClass: "medium",
        dependsOn: [],
        timeoutMs: 5000,
        fieldSources: {},
      },
    ],
  },
  derivations: [
    {
      id: "dwellingValue",
      stage: "pre_rate",
      label: "Dwelling value (rounded)",
      kind: "money",
      expression: "round(call.rce.insurableReplacementCost / 1000) * 1000",
    },
  ],
  mappings: [
    {
      from: "call.hazards.distanceToCoastMiles",
      to: "locations[0].distanceToCoast",
      mode: "prefill",
    },
    { from: "call.hazards.protectionClass", to: "locations[0].protectionClass", mode: "prefill" },
    { from: "call.rce.squareFeet", to: "locations[0].squareFeet", mode: "prefill" },
    { from: "derived.dwellingValue", to: "locations[0].replacementCost", mode: "prefill" },
  ],
  transforms: [],
  reports: [
    {
      id: "rce_report",
      stage: "pre_rate",
      title: "Replacement cost report",
      callId: "rce",
      source: "vendor_then_template",
      template: "rce_report",
    },
  ],
};

/** Rates per $1,000 of dwelling by protection class and construction. */
export function baseRates(frameAtClassOne: number, perClass: number) {
  const relativity: Record<keyof typeof CONSTRUCTION, number> = {
    frame: 1,
    masonry_veneer: 0.93,
    masonry: 0.87,
    superior: 0.8,
  };

  return Array.from({ length: 10 }, (_, i) => i + 1).flatMap((pc) =>
    Object.entries(relativity).map(([construction, factor]) => ({
      keys: [pc, construction],
      value: ((frameAtClassOne + perClass * (pc - 1)) * factor).toFixed(2),
    })),
  );
}

export const band = (from: number | undefined, to: number | undefined, value: string) => ({
  keys: [{ ...(from !== undefined && { from }), ...(to !== undefined && { to }) }],
  value,
});

export const exact = (key: number | string, value: string) => ({ keys: [key], value });

export const included = (coverage: string, exposure?: string) => ({
  coverage,
  ...(exposure && { exposure }),
  steps: [
    {
      op: "expression",
      name: "included",
      label: "Included in the dwelling premium",
      expression: "0",
    },
  ],
  premium: "included",
});

export const flatRate = (coverage: string, table: string, label: string) => ({
  coverage,
  steps: [{ op: "lookup", name: "rate", label, table, keys: [{ path: "coverage.limit" }] }],
  premium: "rate",
});

export const LIFECYCLE = {
  term: { months: 12 },
  quote: { validityDays: 30, referralReviewHours: 24 },
  rounding: { mode: "half_up", places: 2 },
  transactions: { cancellation: { method: "pro_rata" }, reinstatement: { windowDays: 30 } },
};
