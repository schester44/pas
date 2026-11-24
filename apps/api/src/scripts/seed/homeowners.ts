import {
  attestationGroup,
  attestations,
  complianceDecisions,
  HOMEOWNERS_BROKER_FEES,
} from "./compliance";
import { col, decision, outputs, type Row, table, text } from "./decisions";
import { BILLING, documentSet } from "./documents";
import {
  band,
  baseRates,
  CONSTRUCTION,
  dollars,
  ENRICHMENT,
  exact,
  field,
  flatRate,
  included,
  insuredGroup,
  LIFECYCLE,
  mailingAddress,
  percents,
} from "./fields";

export interface HomeownersProgram {
  key: string;
  name: string;
  carrier: string;
  issuer: string;
  form: "HO-3" | "HO-5";
  market: "admitted" | "non_admitted";
  liability: { options: number[]; selected: number };
  medicalPayments: { options: number[]; selected: number };
  deductibles: { options: number[]; selected: number };
  waterBackup: number[] | null;
  equipmentBreakdown: boolean;
  rates: { frameAtClassOne: number; perClass: number; minimumPremium: number };
  underwriting: Row[];
  inspections: Row[];
  carrierAttestations: boolean;
}

const RISK_SCHEMA = {
  fields: [
    insuredGroup({ individual: "An individual", trust: "A trust" }),
    mailingAddress,
    field.group("priorInsurance", "Prior insurance", [
      field.integer("lapseDays", "Days without home insurance in the last 3 years"),
      field.boolean("firstTimeBuyer", "First-time home buyer"),
    ]),
    field.group("lossHistory", "Loss history (last 5 years)", [
      field.integer("claims", "Claims"),
      field.integer("openClaims", "Open claims"),
      field.integer("liabilityLosses", "Liability losses"),
      field.integer("largestLoss", "Largest single loss ($)"),
    ]),
    {
      key: "locations",
      kind: "repeatable",
      label: "Residence",
      exposure: "location",
      minItems: 1,
      maxItems: 1,
      children: [
        field.address("address", "Property address"),
        field.choice("residenceType", "Residence type", {
          single_family: "Single-family",
          townhouse: "Townhome",
          rowhome: "Rowhome",
          condo: "Condo",
        }),
        field.choice("residenceUse", "Occupancy", {
          primary: "Primary residence",
          secondary: "Secondary residence",
          vacant: "Vacant",
        }),
        field.integer("units", "Family units"),
        field.integer("yearBuilt", "Year built"),
        field.integer("squareFeet", "Square feet"),
        field.choice("construction", "Construction", CONSTRUCTION),
        field.integer("roofAge", "Roof age (years)", { endorsable: true }),
        field.integer("protectionClass", "Protection class", { endorsable: true }),
        field.number("distanceToCoast", "Distance to coast (miles)"),
        field.money("replacementCost", "Replacement cost"),
        field.boolean("isMobileHome", "Mobile or manufactured home"),
        field.boolean("hasWoodstove", "Solid fuel heating (wood or pellet stove)"),
        field.boolean("hasPool", "Swimming pool"),
        field.boolean("constructionInProgress", "Construction or major renovation in progress"),
        field.boolean("homeBusiness", "Business run from the home"),
        field.boolean("shortTermRental", "Rented short term (under 30 days)"),
        field.boolean("hasLivestock", "Livestock or saddle animals"),
        field.boolean("centralFireAlarm", "Central station fire alarm", { endorsable: true }),
        field.boolean("centralBurglarAlarm", "Central station burglar alarm", { endorsable: true }),
        field.boolean("hasSumpPump", "Sump pump with battery backup", { endorsable: true }),
      ],
    },
  ],
};

const item = (path: string, extra: Record<string, unknown> = {}) => ({ path, ...extra });
const half = { width: "half" };
const check = { widget: "checkbox" };

const QUOTE_FORM = {
  key: "homeowners-quote",
  title: "Homeowners quote",
  steps: [
    {
      id: "applicant",
      title: "Applicant",
      sections: [
        {
          id: "insured",
          title: "Named insured",
          items: [
            item("insured.entityType", { widget: "radio", required: true }),
            item("insured.firstName", { ...half, required: true }),
            item("insured.lastName", { ...half, required: true }),
            item("insured.businessName", { help: "The trust's name, when a trust owns the home." }),
            item("insured.email", { ...half, required: true }),
            item("insured.phone", half),
            item("mailingAddress", { required: true }),
          ],
        },
        {
          id: "prior",
          title: "Prior insurance",
          items: [
            item("priorInsurance.lapseDays", { required: true }),
            item("priorInsurance.firstTimeBuyer", check),
          ],
        },
      ],
    },
    {
      id: "property",
      title: "Property",
      sections: [
        {
          id: "residence",
          title: "Residence",
          repeat: "locations",
          itemLabel: "Residence",
          items: [
            item("address", { required: true }),
            item("residenceType", { ...half, required: true }),
            item("residenceUse", { ...half, required: true }),
            item("units", { ...half, required: true }),
            item("yearBuilt", { ...half, required: true }),
            item("squareFeet", half),
            item("construction", { ...half, required: true }),
            item("roofAge", { ...half, required: true }),
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
          title: "Tell us about the home",
          repeat: "locations",
          itemLabel: "Residence",
          items: [
            item("isMobileHome", check),
            item("hasWoodstove", check),
            item("hasPool", check),
            item("constructionInProgress", check),
            item("homeBusiness", check),
            item("shortTermRental", check),
            item("hasLivestock", check),
            item("centralFireAlarm", check),
            item("centralBurglarAlarm", check),
            item("hasSumpPump", check),
          ],
        },
        {
          id: "losses",
          title: "Loss history",
          items: [
            item("lossHistory.claims", { ...half, required: true }),
            item("lossHistory.openClaims", half),
            item("lossHistory.liabilityLosses", half),
            item("lossHistory.largestLoss", half),
          ],
        },
      ],
    },
  ],
};

export const HO = {
  built: col("built", "min(map(locations, #.yearBuilt))", "Year built"),
  condo: col("condo", 'some(locations, #.residenceType == "condo")', "Condo"),
  townhouse: col("townhouse", 'some(locations, #.residenceType == "townhouse")', "Townhome"),
  units: col("units", "max(map(locations, #.units))", "Units"),
  mobile: col("mobile", "some(locations, #.isMobileHome == true)", "Mobile home"),
  woodstove: col("woodstove", "some(locations, #.hasWoodstove == true)", "Solid fuel"),
  vacant: col("vacant", 'some(locations, #.residenceUse == "vacant")', "Vacant"),
  primary: col("primary", 'some(locations, #.residenceUse == "primary")', "Primary residence"),
  secondary: col("secondary", 'some(locations, #.residenceUse == "secondary")', "Secondary"),
  str: col("str", "some(locations, #.shortTermRental == true)", "Short-term rental"),
  building: col("building", "some(locations, #.constructionInProgress == true)", "Construction"),
  livestock: col("livestock", "some(locations, #.hasLivestock == true)", "Livestock"),
  business: col("business", "some(locations, #.homeBusiness == true)", "Home business"),
  fireAlarm: col("fireAlarm", "some(locations, #.centralFireAlarm == true)", "Fire alarm"),
  burglarAlarm: col(
    "burglarAlarm",
    "some(locations, #.centralBurglarAlarm == true)",
    "Burglar alarm",
  ),
  rc: col("rc", 'max(map(locations, number(#.replacementCost ?? "0")))', "Replacement cost"),
  claims: col("claims", "lossHistory.claims ?? 0", "Claims"),
  open: col("open", "lossHistory.openClaims ?? 0", "Open claims"),
  liabilityLosses: col("liabilityLosses", "lossHistory.liabilityLosses ?? 0", "Liability losses"),
  largest: col("largest", "lossHistory.largestLoss ?? 0", "Largest loss"),
  lapse: col("lapse", "priorInsurance.lapseDays ?? 0", "Lapse days"),
  firstTime: col("firstTime", "priorInsurance.firstTimeBuyer == true", "First-time buyer"),
  state: col("state", "jurisdiction.subdivision", "State"),
};

export const decline = (
  description: string,
  reasonCode: string,
  message: string,
  cells: Record<string, string>,
): Row => ({
  _description: description,
  ...cells,
  outcome: text("decline"),
  reasonCode: text(reasonCode),
  message: text(message),
});

export const refer = (
  description: string,
  reasonCode: string,
  message: string,
  authority: string,
  cells: Record<string, string>,
): Row => ({
  ...decline(description, reasonCode, message, cells),
  outcome: text("refer"),
  authority: text(authority),
});

/** The eligibility every homeowners program shares: one-family, owner-lived-in, no farm or business exposure. */
export const HOMEOWNERS_BASE_RULES: Row[] = [
  decline("Condos", "CONDO", "Condos aren't eligible", { condo: "true" }),
  decline(
    "More than one family unit",
    "MULTI_FAMILY",
    "Homes with more than one family unit belong on a landlord policy",
    { units: "> 1" },
  ),
  decline(
    "Mobile or manufactured",
    "MOBILE_HOME",
    "Mobile and manufactured homes aren't eligible",
    { mobile: "true" },
  ),
  decline("Solid fuel heating", "SOLID_FUEL", "Solid fuel heating devices aren't eligible", {
    woodstove: "true",
  }),
];

export function homeownersRules(program: HomeownersProgram) {
  const used = new Set(program.underwriting.flatMap((row) => Object.keys(row)));
  const columns = Object.values(HO).filter((column) => used.has(column.id));

  return decision(
    "underwriting",
    `${program.name} underwriting`,
    table(
      `${program.name} underwriting`,
      columns,
      outputs("outcome", "reasonCode", "message", "authority"),
      program.underwriting,
    ),
    [
      {
        id: "clean",
        name: "A typical primary residence passes",
        input: sampleRisk(),
        expected: { outcomes: [], overall: "pass" },
      },
    ],
  );
}

export function sampleRisk(overrides: Record<string, unknown> = {}) {
  return {
    insured: {
      entityType: "individual",
      firstName: "Jordan",
      lastName: "Avery",
      email: "jordan.avery@example.com",
    },
    mailingAddress: {
      line1: "1420 Judson Ave",
      city: "Evanston",
      region: "IL",
      postalCode: "60201",
      country: "US",
    },
    priorInsurance: { lapseDays: 0, firstTimeBuyer: false },
    lossHistory: { claims: 0, openClaims: 0, liabilityLosses: 0, largestLoss: 0 },
    locations: [
      {
        address: {
          line1: "1420 Judson Ave",
          city: "Evanston",
          region: "IL",
          postalCode: "60201",
          country: "US",
        },
        residenceType: "single_family",
        residenceUse: "primary",
        units: 1,
        yearBuilt: 1998,
        squareFeet: 2400,
        construction: "frame",
        roofAge: 8,
        protectionClass: 3,
        distanceToCoast: 40,
        replacementCost: "550000",
        isMobileHome: false,
        hasWoodstove: false,
        hasPool: false,
        constructionInProgress: false,
        homeBusiness: false,
        shortTermRental: false,
        hasLivestock: false,
        centralFireAlarm: false,
        centralBurglarAlarm: false,
        hasSumpPump: true,
        ...overrides,
      },
    ],
    jurisdiction: { country: "US", subdivision: "US-IL" },
    market: "non_admitted",
  };
}

const ROOF = band;

function ratingPlan(program: HomeownersProgram) {
  const formFactor = program.form === "HO-5" ? "1.18" : "1.00";

  const algorithms: unknown[] = [
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
          name: "age",
          label: "Home age",
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
          name: "protective",
          label: "Protective device credit",
          condition: "exposure.centralFireAlarm == true and exposure.centralBurglarAlarm == true",
          whenTrue: { value: 0.95 },
          whenFalse: { value: 1 },
        },
        {
          op: "expression",
          name: "form",
          label: `${program.form} form factor`,
          expression: formFactor,
        },
        {
          op: "multiply",
          name: "premium",
          label: "Dwelling premium",
          operands: [
            "base",
            "aoi",
            "age",
            "roof",
            "deductible",
            "losses",
            "protective",
            "form",
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
    included("personal_property", "locations[]"),
    included("loss_of_use", "locations[]"),
    flatRate("personal_liability", "liability_rate", "Liability rate"),
    flatRate("medical_payments", "medical_payments_rate", "Medical payments rate"),
  ];

  if (program.waterBackup) {
    algorithms.push({
      coverage: "water_backup",
      exposure: "locations[]",
      premium: "rounded",
      steps: [
        {
          op: "lookup",
          name: "rate",
          label: "Water backup rate",
          table: "water_backup_rate",
          keys: [{ path: "coverage.limit" }],
        },
        {
          op: "if",
          name: "sump",
          label: "Sump pump credit",
          condition: "exposure.hasSumpPump == true",
          whenTrue: { value: 0.85 },
          whenFalse: { value: 1 },
        },
        {
          op: "multiply",
          name: "premium",
          label: "Water backup premium",
          operands: [{ step: "rate" }, { step: "sump" }],
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
    });
  }

  if (program.equipmentBreakdown) {
    algorithms.push(
      flatRate("equipment_breakdown", "equipment_breakdown_rate", "Equipment breakdown rate"),
    );
  }

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
        rows: baseRates(program.rates.frameAtClassOne, program.rates.perClass),
      },
      {
        key: "year_built_factor",
        dimensions: [{ name: "year_built", match: "band" }],
        rows: [
          band(undefined, 1950, "1.25"),
          band(1950, 1980, "1.12"),
          band(1980, 2000, "1.00"),
          band(2000, 2010, "0.92"),
          band(2010, undefined, "0.85"),
        ],
      },
      {
        key: "roof_age_factor",
        dimensions: [{ name: "roof_age", match: "band" }],
        rows: [
          ROOF(0, 10, "0.95"),
          ROOF(10, 15, "1.00"),
          ROOF(15, 20, "1.10"),
          ROOF(20, 25, "1.25"),
          ROOF(25, undefined, "1.45"),
        ],
      },
      {
        key: "deductible_factor",
        dimensions: [{ name: "deductible", match: "exact" }],
        rows: [
          exact(1000, "1.00"),
          exact(2500, "0.88"),
          exact(5000, "0.78"),
          exact(7500, "0.72"),
          exact(10000, "0.68"),
          exact(25000, "0.55"),
        ],
      },
      {
        key: "claims_factor",
        dimensions: [{ name: "claims", match: "band" }],
        rows: [
          band(0, 1, "1.00"),
          band(1, 2, "1.15"),
          band(2, 3, "1.35"),
          band(3, undefined, "1.60"),
        ],
      },
      {
        key: "liability_rate",
        dimensions: [{ name: "limit", match: "exact" }],
        rows: [
          exact(25000, "18"),
          exact(50000, "24"),
          exact(100000, "38"),
          exact(300000, "62"),
          exact(500000, "84"),
          exact(1000000, "128"),
        ],
      },
      {
        key: "medical_payments_rate",
        dimensions: [{ name: "limit", match: "exact" }],
        rows: [exact(1000, "8"), exact(5000, "18"), exact(10000, "30")],
      },
      {
        key: "water_backup_rate",
        dimensions: [{ name: "limit", match: "exact" }],
        rows: [exact(5000, "45"), exact(10000, "75"), exact(25000, "140")],
      },
      {
        key: "equipment_breakdown_rate",
        dimensions: [{ name: "limit", match: "exact" }],
        rows: [exact(100000, "45")],
      },
    ],
    algorithms,
  };
}

function coverages(program: HomeownersProgram) {
  const location = { level: "exposure", path: "locations" };
  const contents = program.form === "HO-5" ? 70 : 50;

  return [
    {
      code: "dwelling",
      name: "Dwelling (Coverage A)",
      description: "The home and structures attached to it.",
      attachesTo: location,
      required: true,
      dependsOn: [],
      limitOptions: dollars(
        [200000, 300000, 400000, 500000, 600000, 750000, 1000000, 1500000],
        400000,
      ),
      deductibleOptions: dollars(program.deductibles.options, program.deductibles.selected),
    },
    {
      code: "other_structures",
      name: "Other structures (Coverage B)",
      description: "Detached garages, sheds and fences, as a share of the dwelling limit.",
      attachesTo: location,
      required: true,
      dependsOn: ["dwelling"],
      limitOptions: percents([10, 20], 10),
    },
    {
      code: "personal_property",
      name: "Personal property (Coverage C)",
      description:
        program.form === "HO-5"
          ? "Belongings, covered on an open-perils basis."
          : "Belongings, covered for named perils.",
      attachesTo: location,
      required: true,
      dependsOn: ["dwelling"],
      limitOptions: percents([50, 70], contents),
    },
    {
      code: "loss_of_use",
      name: "Loss of use (Coverage D)",
      description: "Additional living expenses while the home is being repaired.",
      attachesTo: location,
      required: true,
      dependsOn: ["dwelling"],
      limitOptions: percents([20, 30], 20),
    },
    {
      code: "personal_liability",
      name: "Personal liability (Coverage E)",
      attachesTo: { level: "policy" },
      required: true,
      dependsOn: [],
      limitOptions: dollars(program.liability.options, program.liability.selected),
    },
    {
      code: "medical_payments",
      name: "Medical payments (Coverage F)",
      attachesTo: { level: "policy" },
      required: true,
      dependsOn: [],
      limitOptions: dollars(program.medicalPayments.options, program.medicalPayments.selected),
    },
    ...(program.waterBackup
      ? [
          {
            code: "water_backup",
            name: "Water backup and sump overflow",
            description: "Water that backs up through sewers or drains.",
            attachesTo: location,
            required: false,
            dependsOn: ["dwelling"],
            limitOptions: dollars(program.waterBackup, program.waterBackup[0]!),
          },
        ]
      : []),
    ...(program.equipmentBreakdown
      ? [
          {
            code: "equipment_breakdown",
            name: "Equipment breakdown",
            description: "Sudden breakdown of home systems and appliances.",
            attachesTo: { level: "policy" },
            required: false,
            dependsOn: [],
            limitOptions: dollars([100000], 100000),
          },
        ]
      : []),
  ];
}

const tiv = col("tiv", "quote.tiv", "Total insured value");

function referrals() {
  return decision(
    "referral_triggers",
    "Underwriter review triggers",
    table(
      "Underwriter review triggers",
      [tiv, HO.secondary, HO.claims],
      outputs("code", "message", "authority"),
      [
        {
          _description: "High value homes need a senior review",
          tiv: ">= 1500000",
          code: text("HIGH_TIV"),
          message: text("Total insured value of $1.5M or more"),
          authority: text("senior_underwriter"),
        },
        {
          _description: "Secondary home with recent claims",
          secondary: "true",
          claims: ">= 1",
          code: text("SECONDARY_WITH_CLAIMS"),
          message: text("Secondary residence with a claim in the last 5 years"),
          authority: text("underwriter"),
        },
      ],
    ),
  );
}

function subjectivities() {
  return decision(
    "subjectivities",
    "Homeowners subjectivities",
    table(
      "Homeowners subjectivities",
      [HO.lapse, HO.firstTime, HO.built],
      outputs("code", "title", "description", "timing", "dueDays", "owner", "consequence"),
      [
        {
          _description: "Coverage gap",
          lapse: "> 0",
          firstTime: "false",
          code: text("PRIOR_INSURANCE"),
          title: text("Proof of prior insurance"),
          description: text("Declarations page from the prior carrier showing the expiration date"),
          timing: text("post_bind"),
          dueDays: "30",
          owner: text("producer"),
          consequence: text("Consider cancellation for missing proof of prior insurance"),
        },
        {
          _description: "Older home systems",
          built: "< 1950",
          code: text("SYSTEMS_UPDATE"),
          title: text("Electrical, plumbing and heating update dates"),
          timing: text("post_bind"),
          dueDays: "30",
          owner: text("insured"),
        },
      ],
    ),
  );
}

function inspections(program: HomeownersProgram) {
  return decision(
    "inspection_requirements",
    "Post-bind inspections",
    table(
      "Post-bind inspections",
      [tiv, HO.lapse, HO.firstTime, HO.claims, HO.secondary],
      outputs("code", "type", "timing", "reason"),
      program.inspections,
    ),
  );
}

export const STANDARD_INSPECTIONS: Row[] = [
  {
    _description: "Prior insurance lapse over 30 days",
    lapse: "> 30",
    firstTime: "false",
    code: text("PRIOR_INSURANCE_LAPSE"),
    type: text("exterior"),
    timing: text("post_bind"),
    reason: text("Prior insurance lapsed more than 30 days"),
  },
  {
    _description: "Claims on a secondary residence",
    claims: "> 1",
    secondary: "true",
    code: text("CLAIMS_WITH_SECONDARY_RESIDENCE"),
    type: text("exterior"),
    timing: text("post_bind"),
    reason: text("More than one claim on a secondary residence"),
  },
  {
    _description: "High replacement cost",
    tiv: "> 1000000",
    code: text("HIGH_REPLACEMENT_COST"),
    type: text("interior_exterior"),
    timing: text("post_bind"),
    reason: text("Total insured value over $1,000,000"),
  },
];

const CARRIER_ATTESTATIONS = [
  attestationGroup(
    "APPLICANT_CONDITIONS",
    "Applicant conditions",
    "I acknowledge that none of the following apply to the applicant:",
    [
      "An open foreclosure, repossession or bankruptcy.",
      "A foreclosure, repossession or bankruptcy during the past 5 years.",
      "An indictment or conviction for fraud, bribery, arson or any arson-related crime in the last 5 years.",
      "A public figure, athlete or other high-profile individual.",
    ],
  ),
  attestationGroup(
    "DWELLING_CONDITIONS",
    "Dwelling conditions",
    "I acknowledge that none of the following apply to the dwelling:",
    [
      "Less than average condition, unsecured, not properly maintained or inactive utilities.",
      "Existing damage to the dwelling.",
      "A foundation that is unstable, damaged or doesn't meet building code.",
      "Unconventional construction: balloon, fiberglass, geodesic dome, yurt, tiny house, tree house, houseboat or floating home.",
      "Designated as historical.",
      "EIFS exterior built before 1998 with no weep or drainage system.",
      "Construction in progress or demolition of exterior walls.",
      "Chinese drywall, lead paint or asbestos exposure.",
      "Mold that wasn't professionally remediated.",
      "Used as student housing.",
      "Fuses, knob and tube or aluminum wiring, or circuit breakers under 100 amps.",
      "Federal Pacific, Stab-Lok, Zinsco, Sylvania or Challenger breaker panels.",
      "Galvanized, polybutylene, cast iron or lead supply or waste lines.",
      "A primary heat source that isn't thermostatically controlled central heat.",
    ],
  ),
  attestationGroup(
    "PROPERTY_CONDITIONS",
    "Property conditions",
    "I acknowledge that none of the following apply to the property:",
    [
      "Property or liability conditions that caused coverage to be declined, cancelled or non-renewed in the last 3 years.",
      "More than 2 mortgages, or a mortgagee that isn't a financial institution.",
      "Saddle animals or livestock.",
      "Within 300 feet of a commercial property that increases the hazard to the dwelling.",
      "Commercial garage exposures on the premises or adjacent structures.",
      "Ivy or foliage growing directly on exterior walls.",
      "Underground fuel tanks.",
    ],
  ),
];

export function homeownersContents(program: HomeownersProgram) {
  return {
    riskSchema: RISK_SCHEMA,
    forms: [
      { channel: "agent", stage: "quote", form: QUOTE_FORM },
      {
        channel: "customer",
        stage: "quote",
        form: { ...QUOTE_FORM, key: "homeowners-quote-customer" },
      },
    ],
    coverages: coverages(program),
    lifecycle: LIFECYCLE,
    documents: documentSet({
      declarationsTitle: `Homeowners ${program.form} declarations`,
      issuer: program.issuer,
      proposalIntro:
        "Thank you for the opportunity to quote your home insurance. This proposal summarizes the coverages we can offer for the home below. Review the limits and deductibles with your agent, then sign to apply.",
      locationColumns: [
        { path: "address", label: "Residence" },
        { path: "yearBuilt", label: "Year built" },
        { path: "construction", label: "Construction" },
        { path: "residenceUse", label: "Occupancy" },
      ],
      coverageNotes: [
        {
          coverage: "water_backup",
          body: "**Water backup.** This policy covers direct physical loss caused by water that backs up through sewers or drains, up to the limit shown above.",
        },
      ],
    }),
    rules: [
      homeownersRules(program),
      referrals(),
      subjectivities(),
      inspections(program),
      attestations(program.carrierAttestations ? CARRIER_ATTESTATIONS : []),
      ...complianceDecisions(HOMEOWNERS_BROKER_FEES),
    ],
    rating: { engine: "plan", plan: ratingPlan(program), goldenCases: [] },
    billing: BILLING,
    enrichment: ENRICHMENT,
  };
}

export const homeownersGoldenRisk = sampleRisk;
