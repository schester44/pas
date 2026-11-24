import {
  attestationGroup,
  attestations,
  complianceDecisions,
  LANDLORD_BROKER_FEES,
} from "./compliance";
import { col, decision, outputs, type Row, table, text } from "./decisions";
import { BILLING, detailedReplacementCostReport, documentSet } from "./documents";
import {
  band,
  baseRates,
  CONSTRUCTION,
  dollars,
  enrichmentPlan,
  exact,
  field,
  flatRate,
  included,
  insuredGroup,
  LIFECYCLE,
  mailingAddress,
  percents,
} from "./fields";
import { decline, refer } from "./homeowners";

export interface LandlordProgram {
  key: string;
  name: string;
  carrier: string;
  issuer: string;
  market: "admitted" | "non_admitted";
  liability: { options: number[]; selected: number };
  deductibles: { options: number[]; selected: number };
  rates: { frameAtClassOne: number; perClass: number; minimumPremium: number };
  underwriting: Row[];
  /** The carrier's own replacement cost estimate, fed construction and stories. */
  detailedReplacementCost?: boolean;
}

const RISK_SCHEMA = {
  fields: [
    insuredGroup({ individual: "An individual", llc: "An LLC", trust: "A trust" }),
    mailingAddress,
    field.group("lossHistory", "Loss history (last 5 years)", [
      field.integer("claims", "Claims"),
      field.integer("largestLoss", "Largest single loss ($)"),
    ]),
    {
      key: "locations",
      kind: "repeatable",
      label: "Rental property",
      exposure: "location",
      minItems: 1,
      maxItems: 1,
      children: [
        field.address("address", "Property address"),
        field.choice("dwellingType", "Dwelling type", {
          single_family: "Single-family",
          duplex: "Duplex",
          triplex: "Triplex",
          quadplex: "Quadplex",
          townhouse: "Townhome",
          condo: "Condo",
        }),
        field.integer("units", "Rental units"),
        field.integer("ownerOccupiedUnits", "Units the owner lives in"),
        field.integer("stories", "Stories"),
        field.integer("yearBuilt", "Year built"),
        field.integer("squareFeet", "Square feet"),
        field.choice("construction", "Construction", { ...CONSTRUCTION, log: "Log" }),
        field.integer("roofAge", "Roof age (years)", { endorsable: true }),
        field.choice("roofCovering", "Roof covering", {
          asphalt_shingle: "Asphalt shingle",
          architectural_shingle: "Architectural shingle",
          metal: "Metal",
          tile: "Tile",
          slate: "Slate",
          wood_shake: "Wood shake",
        }),
        field.integer("protectionClass", "Protection class", { endorsable: true }),
        field.number("distanceToCoast", "Distance to coast (miles)"),
        field.money("replacementCost", "Replacement cost"),
        field.boolean("isMobileHome", "Mobile or manufactured home"),
        field.boolean("knobAndTube", "Knob and tube wiring"),
        field.boolean("under100Amps", "Electrical service under 100 amps"),
        field.boolean("extendedVacancy", "Vacant more than 60 consecutive days during the term"),
        field.boolean("majorRenovations", "Major renovations planned during the term"),
        field.boolean("intendsToResell", "Bought to renovate and resell"),
        field.boolean("shortTermRental", "Rented nightly or hourly"),
        field.boolean("professionallyManaged", "Professionally managed", { endorsable: true }),
      ],
    },
  ],
};

const item = (path: string, extra: Record<string, unknown> = {}) => ({ path, ...extra });
const half = { width: "half" };
const check = { widget: "checkbox" };

const QUOTE_FORM = {
  key: "landlord-quote",
  title: "Landlord quote",
  steps: [
    {
      id: "owner",
      title: "Owner",
      sections: [
        {
          id: "insured",
          title: "Named insured",
          items: [
            item("insured.entityType", { widget: "radio", required: true }),
            item("insured.firstName", { ...half, required: true }),
            item("insured.lastName", { ...half, required: true }),
            item("insured.businessName", {
              help: "The LLC or trust that owns the property, if any.",
            }),
            item("insured.email", { ...half, required: true }),
            item("insured.phone", half),
            item("mailingAddress", { required: true }),
          ],
        },
      ],
    },
    {
      id: "property",
      title: "Property",
      sections: [
        {
          id: "rental",
          title: "Rental property",
          repeat: "locations",
          itemLabel: "Property",
          items: [
            item("address", { required: true }),
            item("dwellingType", { ...half, required: true }),
            item("units", { ...half, required: true }),
            item("ownerOccupiedUnits", { ...half, required: true }),
            item("stories", { ...half, required: true }),
            item("yearBuilt", { ...half, required: true }),
            item("squareFeet", half),
            item("construction", { ...half, required: true }),
            item("roofAge", { ...half, required: true }),
            item("roofCovering", half),
            item("protectionClass", { ...half, help: "1 is best, 10 is unprotected." }),
            item("distanceToCoast", half),
            item("replacementCost", half),
          ],
        },
      ],
    },
    {
      id: "underwriting",
      title: "Underwriting",
      sections: [
        {
          id: "questions",
          title: "Tell us about the rental",
          repeat: "locations",
          itemLabel: "Property",
          items: [
            item("isMobileHome", check),
            item("knobAndTube", check),
            item("under100Amps", check),
            item("extendedVacancy", check),
            item("majorRenovations", check),
            item("intendsToResell", check),
            item("shortTermRental", check),
            item("professionallyManaged", check),
          ],
        },
        {
          id: "losses",
          title: "Loss history",
          items: [
            item("lossHistory.claims", { ...half, required: true }),
            item("lossHistory.largestLoss", half),
          ],
        },
      ],
    },
  ],
};

const loc = (id: string, expression: string, name: string) => col(id, expression, name);

export const DP = {
  units: loc("units", "max(map(locations, #.units))", "Units"),
  ownerUnits: loc(
    "ownerUnits",
    "max(map(locations, #.ownerOccupiedUnits ?? 0))",
    "Owner-occupied units",
  ),
  stories: loc("stories", "max(map(locations, #.stories))", "Stories"),
  built: loc("built", "min(map(locations, #.yearBuilt))", "Year built"),
  roof: loc("roof", "max(map(locations, #.roofAge))", "Roof age"),
  condo: loc("condo", 'some(locations, #.dwellingType == "condo")', "Condo"),
  log: loc("log", 'some(locations, #.construction == "log")', "Log construction"),
  roofCovering: loc(
    "roofCovering",
    'some(locations, #.roofCovering == "wood_shake" or #.roofCovering == "slate")',
    "Wood shake or slate roof",
  ),
  mobile: loc("mobile", "some(locations, #.isMobileHome == true)", "Mobile home"),
  knobAndTube: loc("knobAndTube", "some(locations, #.knobAndTube == true)", "Knob and tube"),
  amps: loc("amps", "some(locations, #.under100Amps == true)", "Under 100 amps"),
  vacancy: loc("vacancy", "some(locations, #.extendedVacancy == true)", "Extended vacancy"),
  renovations: loc("renovations", "some(locations, #.majorRenovations == true)", "Renovations"),
  resell: loc("resell", "some(locations, #.intendsToResell == true)", "Resell intent"),
  str: loc("str", "some(locations, #.shortTermRental == true)", "Short-term rental"),
  coast: loc("coast", "min(map(locations, #.distanceToCoast ?? 100))", "Miles to coast"),
  pc: loc("pc", "max(map(locations, #.protectionClass))", "Protection class"),
  rc: loc("rc", 'max(map(locations, number(#.replacementCost ?? "0")))', "Replacement cost"),
  claims: col("claims", "lossHistory.claims ?? 0", "Claims"),
  largest: col("largest", "lossHistory.largestLoss ?? 0", "Largest loss"),
};

/** Eligibility shared by every landlord program: 1-4 units, tenant-occupied, no vacancy or flips. */
export const LANDLORD_BASE_RULES: Row[] = [
  decline(
    "More than 4 units",
    "TOO_MANY_UNITS",
    "Dwellings with more than 4 units aren't eligible",
    { units: "> 4" },
  ),
  decline(
    "Owner lives in a single-unit dwelling",
    "OWNER_OCCUPIED",
    "An owner-occupied single-unit home belongs on a homeowners policy",
    {
      units: "== 1",
      ownerUnits: ">= 1",
    },
  ),
  decline(
    "Owner lives in more than one unit",
    "OWNER_OCCUPIED",
    "The owner can live in at most one unit",
    { ownerUnits: "> 1" },
  ),
  decline(
    "Mobile or manufactured",
    "MOBILE_HOME",
    "Mobile and manufactured homes aren't eligible",
    { mobile: "true" },
  ),
  decline(
    "Built 1950 or earlier with knob and tube wiring",
    "KNOB_AND_TUBE",
    "Knob and tube wiring isn't eligible",
    {
      built: "<= 1950",
      knobAndTube: "true",
    },
  ),
  decline(
    "Built 1950 or earlier below 100 amps",
    "ELECTRICAL_AMPERAGE",
    "Electrical service under 100 amps isn't eligible",
    {
      built: "<= 1950",
      amps: "true",
    },
  ),
  decline(
    "Extended vacancy",
    "VACANCY",
    "Properties vacant more than 60 days during the term aren't eligible",
    { vacancy: "true" },
  ),
  decline(
    "Major renovations during the term",
    "MAJOR_RENOVATIONS",
    "Major renovations during the term aren't eligible",
    { renovations: "true" },
  ),
  decline(
    "Bought to resell",
    "RESELL_INTENT",
    "Properties bought to renovate and resell aren't eligible",
    { resell: "true" },
  ),
  decline(
    "Nightly or hourly rentals",
    "SHORT_TERM_RENTAL",
    "Nightly and hourly rentals aren't eligible",
    { str: "true" },
  ),
  decline("Three or more claims", "LOSS_HISTORY", "Three or more claims in the last 5 years", {
    claims: ">= 3",
  }),
  refer("Two claims", "LOSS_HISTORY_REVIEW", "Two claims in the last 5 years", "underwriter", {
    claims: "== 2",
  }),
  decline(
    "Single loss over $100,000",
    "LARGE_LOSS",
    "A single loss over $100,000 in the last 5 years",
    { largest: "> 100000" },
  ),
];

function underwriting(program: LandlordProgram) {
  const used = new Set(program.underwriting.flatMap((row) => Object.keys(row)));

  return decision(
    "underwriting",
    `${program.name} underwriting`,
    table(
      `${program.name} underwriting`,
      Object.values(DP).filter((column) => used.has(column.id)),
      outputs("outcome", "reasonCode", "message", "authority"),
      program.underwriting,
    ),
    [
      {
        id: "clean",
        name: "A tenant-occupied duplex passes",
        input: landlordRisk(),
        expected: { outcomes: [], overall: "pass" },
      },
    ],
  );
}

export function landlordRisk(overrides: Record<string, unknown> = {}) {
  return {
    insured: {
      entityType: "llc",
      firstName: "Morgan",
      lastName: "Price",
      businessName: "Price Rentals LLC",
      email: "morgan.price@example.com",
    },
    mailingAddress: {
      line1: "200 W Madison St",
      line2: "Suite 900",
      city: "Chicago",
      region: "IL",
      postalCode: "60606",
      country: "US",
    },
    lossHistory: { claims: 0, largestLoss: 0 },
    locations: [
      {
        address: {
          line1: "2217 W Belmont Ave",
          city: "Chicago",
          region: "IL",
          postalCode: "60618",
          country: "US",
        },
        dwellingType: "duplex",
        units: 2,
        ownerOccupiedUnits: 0,
        stories: 2,
        yearBuilt: 1962,
        squareFeet: 2100,
        construction: "masonry",
        roofAge: 9,
        roofCovering: "architectural_shingle",
        protectionClass: 2,
        distanceToCoast: 60,
        replacementCost: "420000",
        isMobileHome: false,
        knobAndTube: false,
        under100Amps: false,
        extendedVacancy: false,
        majorRenovations: false,
        intendsToResell: false,
        shortTermRental: false,
        professionallyManaged: true,
        ...overrides,
      },
    ],
    jurisdiction: { country: "US", subdivision: "US-IL" },
    market: "non_admitted",
  };
}

function ratingPlan(program: LandlordProgram) {
  return {
    key: program.key.replaceAll("-", "_"),
    version: "2026.1",
    currency: "USD",
    rounding: { mode: "half_up", places: 2 },
    minimumPremium: String(program.rates.minimumPremium),
    tables: [
      {
        key: "base_rate",
        dimensions: [
          { name: "protection_class", match: "exact" },
          { name: "construction", match: "exact" },
        ],
        rows: [
          ...baseRates(program.rates.frameAtClassOne, program.rates.perClass),
          ...Array.from({ length: 10 }, (_, i) => ({
            keys: [i + 1, "log"],
            value: ((program.rates.frameAtClassOne + program.rates.perClass * i) * 1.2).toFixed(2),
          })),
        ],
      },
      {
        key: "units_factor",
        dimensions: [{ name: "units", match: "exact" }],
        rows: [exact(1, "1.00"), exact(2, "1.12"), exact(3, "1.22"), exact(4, "1.32")],
      },
      {
        key: "year_built_factor",
        dimensions: [{ name: "year_built", match: "band" }],
        rows: [
          band(undefined, 1950, "1.30"),
          band(1950, 1980, "1.15"),
          band(1980, 2000, "1.00"),
          band(2000, undefined, "0.90"),
        ],
      },
      {
        key: "roof_age_factor",
        dimensions: [{ name: "roof_age", match: "band" }],
        rows: [
          band(0, 10, "0.95"),
          band(10, 16, "1.00"),
          band(16, 20, "1.12"),
          band(20, undefined, "1.30"),
        ],
      },
      {
        key: "deductible_factor",
        dimensions: [{ name: "deductible", match: "exact" }],
        rows: [exact(1000, "1.10"), exact(2500, "1.00"), exact(5000, "0.90"), exact(10000, "0.80")],
      },
      {
        key: "claims_factor",
        dimensions: [{ name: "claims", match: "band" }],
        rows: [band(0, 1, "1.00"), band(1, 2, "1.20"), band(2, undefined, "1.45")],
      },
      {
        key: "liability_rate",
        dimensions: [{ name: "limit", match: "exact" }],
        rows: [exact(300000, "95"), exact(500000, "120"), exact(1000000, "165")],
      },
      {
        key: "medical_payments_rate",
        dimensions: [{ name: "limit", match: "exact" }],
        rows: [exact(5000, "15")],
      },
      {
        key: "contents_rate",
        dimensions: [{ name: "limit", match: "exact" }],
        rows: [exact(5000, "25"), exact(10000, "45"), exact(20000, "80")],
      },
      {
        key: "water_backup_rate",
        dimensions: [{ name: "limit", match: "exact" }],
        rows: [exact(10000, "75")],
      },
      {
        key: "loss_assessment_rate",
        dimensions: [{ name: "limit", match: "exact" }],
        rows: [exact(5000, "10"), exact(10000, "18")],
      },
    ],
    algorithms: [
      {
        coverage: "dwelling",
        exposure: "locations[]",
        minimumPremium: String(program.rates.minimumPremium),
        premium: "rounded",
        steps: [
          {
            op: "lookup",
            name: "base",
            label: "Base rate per $1,000",
            table: "base_rate",
            keys: [{ path: "exposure.protectionClass" }, { path: "exposure.construction" }],
          },
          {
            op: "expression",
            name: "aoi",
            label: "Amount of insurance (thousands)",
            expression: "coverage.limit / 1000",
          },
          {
            op: "lookup",
            name: "units",
            label: "Units",
            table: "units_factor",
            keys: [{ path: "exposure.units" }],
          },
          {
            op: "lookup",
            name: "age",
            label: "Building age",
            table: "year_built_factor",
            keys: [{ path: "exposure.yearBuilt" }],
          },
          {
            op: "lookup",
            name: "roof",
            label: "Roof age",
            table: "roof_age_factor",
            keys: [{ path: "exposure.roofAge" }],
          },
          {
            op: "lookup",
            name: "deductible",
            label: "Deductible credit",
            table: "deductible_factor",
            keys: [{ path: "coverage.deductible" }],
          },
          {
            op: "lookup",
            name: "losses",
            label: "Loss history",
            table: "claims_factor",
            keys: [{ path: "risk.lossHistory.claims" }],
          },
          {
            op: "if",
            name: "managed",
            label: "Professional management credit",
            condition: "exposure.professionallyManaged == true",
            whenTrue: { value: 0.95 },
            whenFalse: { value: 1 },
          },
          {
            op: "multiply",
            name: "premium",
            label: "Dwelling premium",
            operands: [
              "base",
              "aoi",
              "units",
              "age",
              "roof",
              "deductible",
              "losses",
              "managed",
            ].map((step) => ({ step })),
          },
          {
            op: "round",
            name: "rounded",
            label: "Rounded to whole dollars",
            value: { step: "premium" },
            mode: "half_up",
            places: 0,
          },
        ],
      },
      included("other_structures", "locations[]"),
      included("fair_rental_value", "locations[]"),
      flatRate("premises_liability", "liability_rate", "Premises liability rate"),
      flatRate("medical_payments", "medical_payments_rate", "Medical payments rate"),
      flatRate("landlord_contents", "contents_rate", "Landlord contents rate"),
      flatRate("water_backup", "water_backup_rate", "Water backup rate"),
      flatRate("loss_assessment", "loss_assessment_rate", "Loss assessment rate"),
    ],
  };
}

function coverages(program: LandlordProgram) {
  const location = { level: "exposure", path: "locations" };

  return [
    {
      code: "dwelling",
      name: "Dwelling (Coverage A)",
      description: "The rental building, on a special form (DP-3) basis.",
      attachesTo: location,
      required: true,
      dependsOn: [],
      limitOptions: dollars([150000, 200000, 300000, 400000, 500000, 750000, 1000000], 300000),
      deductibleOptions: dollars(program.deductibles.options, program.deductibles.selected),
    },
    {
      code: "other_structures",
      name: "Other structures (Coverage B)",
      description: "Detached garages, sheds and fences, as a share of the dwelling limit.",
      attachesTo: location,
      required: true,
      dependsOn: ["dwelling"],
      limitOptions: percents([10], 10),
    },
    {
      code: "fair_rental_value",
      name: "Fair rental value (Coverage D)",
      description: "Rent lost while the property can't be lived in after a covered loss.",
      attachesTo: location,
      required: true,
      dependsOn: ["dwelling"],
      limitOptions: percents([10, 20], 10),
    },
    {
      code: "premises_liability",
      name: "Premises liability",
      attachesTo: { level: "policy" },
      required: true,
      dependsOn: [],
      limitOptions: dollars(program.liability.options, program.liability.selected),
    },
    {
      code: "medical_payments",
      name: "Medical payments to others",
      attachesTo: { level: "policy" },
      required: true,
      dependsOn: [],
      limitOptions: dollars([5000], 5000),
    },
    {
      code: "landlord_contents",
      name: "Landlord's contents",
      description: "Appliances and furnishings the owner provides to tenants.",
      attachesTo: { level: "policy" },
      required: false,
      dependsOn: [],
      limitOptions: dollars([5000, 10000, 20000], 10000),
    },
    {
      code: "water_backup",
      name: "Sewer and water backup",
      attachesTo: { level: "policy" },
      required: false,
      dependsOn: [],
      limitOptions: dollars([10000], 10000),
    },
    {
      code: "loss_assessment",
      name: "Loss assessment",
      description: "The owner's share of an association assessment after a covered loss.",
      attachesTo: { level: "policy" },
      required: false,
      dependsOn: [],
      limitOptions: dollars([5000, 10000], 5000),
    },
  ];
}

const tiv = col("tiv", "quote.tiv", "Total insured value");

function referrals() {
  return decision(
    "referral_triggers",
    "Underwriter review triggers",
    table("Underwriter review triggers", [tiv, DP.units], outputs("code", "message", "authority"), [
      {
        _description: "Large rental needs a senior review",
        tiv: ">= 1000000",
        code: text("HIGH_TIV"),
        message: text("Total insured value of $1M or more"),
        authority: text("senior_underwriter"),
      },
    ]),
  );
}

function subjectivities() {
  return decision(
    "subjectivities",
    "Landlord subjectivities",
    table(
      "Landlord subjectivities",
      [DP.units],
      outputs("code", "title", "description", "timing", "dueDays", "owner", "consequence"),
      [
        {
          _description: "Every rental",
          code: text("LEASE"),
          title: text("Copy of the current lease"),
          description: text("A signed lease for each occupied unit, showing the term and rent"),
          timing: text("post_bind"),
          dueDays: "30",
          owner: text("producer"),
          consequence: text("Consider cancellation for a missing lease"),
        },
        {
          _description: "Multi-unit buildings",
          units: ">= 3",
          code: text("UNIT_RENT_ROLL"),
          title: text("Rent roll"),
          timing: text("post_bind"),
          dueDays: "30",
          owner: text("producer"),
        },
      ],
    ),
  );
}

function inspections() {
  return decision(
    "inspection_requirements",
    "Post-bind inspections",
    table(
      "Post-bind inspections",
      [tiv, DP.built, DP.roof],
      outputs("code", "type", "timing", "reason"),
      [
        {
          _description: "Every new rental gets an exterior survey",
          code: text("NEW_BUSINESS_EXTERIOR"),
          type: text("exterior"),
          timing: text("post_bind"),
          reason: text("Exterior survey on every new rental"),
        },
        {
          _description: "High value rental",
          tiv: ">= 750000",
          code: text("HIGH_TIV_INTERIOR"),
          type: text("interior_exterior"),
          timing: text("post_bind"),
          reason: text("Total insured value of $750,000 or more"),
        },
        {
          _description: "Older building with an aging roof",
          built: "<= 1969",
          roof: "> 10",
          code: text("OLDER_BUILDING_ROOF"),
          type: text("aerial"),
          timing: text("post_bind"),
          reason: text("Built 1969 or earlier with a roof over 10 years old"),
        },
      ],
    ),
  );
}

const LANDLORD_ATTESTATIONS = [
  attestationGroup("DWELLING_RISK", "Dwelling", "None of the following apply to the dwelling:", [
    "Broken windows or bars on windows",
    "Unrepaired or existing damage",
    "A flat roof with inadequate drainage",
    "Portable kerosene heaters or heat that isn't thermostatically controlled",
    "Asbestos construction",
    "Knob and tube wiring, aluminum wiring or a fuse box",
    "Galvanized plumbing",
    "A roof of aluminum, tin, concrete, solar tiles, wood shake or wood shingle",
    "Unusual construction such as a log home, dome, houseboat or barndominium",
  ]),
  attestationGroup("PROPERTY_RISK", "Property", "None of the following apply to the property:", [
    "A tenant-run home business, or commercial space such as an office or retail",
    "Three or more mortgages",
    "Underground oil or fuel tanks",
    "A trampoline without a safety net enclosure",
    "A pool with a diving board or slide, without a self-latching fence, or not maintained year round",
    "Unmanaged brush or vegetation within 25 feet of any structure",
    "Exotic animals or a dog with a bite history",
    "A group home, student housing, halfway house, assisted living, farm or ranch",
    "A shared or co-living arrangement, or a timeshare",
    "Abandoned, condemned, or in foreclosure or receivership",
    "In violation of local, state or federal law",
  ]),
  attestationGroup("APPLICANT", "Applicant", "I acknowledge as the applicant:", [
    "Tenants are required to carry a renters policy with at least $100,000 in liability",
    "There is no history of arson or insurance fraud",
  ]),
];

export function landlordContents(program: LandlordProgram) {
  return {
    riskSchema: RISK_SCHEMA,
    forms: [
      { channel: "agent", stage: "quote", form: QUOTE_FORM },
      {
        channel: "customer",
        stage: "quote",
        form: { ...QUOTE_FORM, key: "landlord-quote-customer" },
      },
    ],
    coverages: coverages(program),
    lifecycle: LIFECYCLE,
    documents: documentSet({
      declarationsTitle: "Dwelling property declarations",
      issuer: program.issuer,
      ...(program.detailedReplacementCost && {
        replacementCostReport: detailedReplacementCostReport(program.issuer),
      }),
      proposalIntro:
        "Thank you for the opportunity to quote insurance for your rental property. This proposal summarizes the coverages we can offer for the property below. Review the limits and deductibles with your agent, then sign to apply.",
      locationColumns: [
        { path: "address", label: "Rental property" },
        { path: "dwellingType", label: "Dwelling type" },
        { path: "units", label: "Units" },
        { path: "yearBuilt", label: "Year built" },
      ],
      coverageNotes: [
        {
          coverage: "fair_rental_value",
          body: "**Fair rental value.** If a covered loss makes the property unfit to live in, we pay the rent you lose while it's repaired, up to the limit shown above.",
        },
      ],
    }),
    rules: [
      underwriting(program),
      referrals(),
      subjectivities(),
      inspections(),
      attestations(LANDLORD_ATTESTATIONS),
      ...complianceDecisions(LANDLORD_BROKER_FEES),
    ],
    rating: { engine: "plan", plan: ratingPlan(program), goldenCases: [] },
    billing: BILLING,
    enrichment: program.detailedReplacementCost
      ? enrichmentPlan({
          rceInputs: {
            constructionType: "locations[0].construction",
            stories: "locations[0].stories",
          },
          reportSource: "template",
        })
      : enrichmentPlan(),
  };
}
