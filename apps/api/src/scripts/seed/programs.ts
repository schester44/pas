import {
  decline,
  HOMEOWNERS_BASE_RULES,
  type HomeownersProgram,
  STANDARD_INSPECTIONS,
} from "./homeowners";
import { LANDLORD_BASE_RULES, type LandlordProgram } from "./landlord";

const states = (codes: string) => codes.split(" ").map((code) => `US-${code}`);

const BROAD = states(
  "AL AR AZ CA CO CT DC DE FL GA IA ID IL IN KS KY LA MA MD ME MI MN MO MS MT NC ND NE NH NJ NM NV OH OK OR PA RI SC SD TN TX UT VA VT WA WI WV WY",
);

/** Where each carrier writes, from its state eligibility rules. */
const FOOTPRINT = {
  broad: BROAD,
  southmere: states(
    "AZ CA CO CT DC DE GA IA ID IL IN KY MA MD ME MI MN MO MT NC ND NE NH NJ NM NV OH OR PA RI SC SD TN UT VT WA WI WV WY",
  ),
  hadrell: states("CO CT GA IA IN KS MA MI MN MO NE OR PA SC TN UT VA WI"),
  starfield: BROAD,
};

export interface SeedCarrier {
  key: string;
  name: string;
  naic: string;
  admitted: string[];
  lines: string[];
  writes: string[];
  /** API carriers rate and issue through a connector; paper carriers get a monthly bordereau. */
  mode: "connector" | "file_feed";
}

export const CARRIERS: SeedCarrier[] = [
  {
    key: "evington",
    name: "Evington Insurance Company",
    naic: "90311",
    admitted: [],
    lines: ["Homeowners", "Landlord"],
    writes: FOOTPRINT.broad,
    mode: "connector",
  },
  {
    key: "spindrift",
    name: "Spindrift Insurance Company",
    naic: "90322",
    admitted: FOOTPRINT.broad,
    lines: ["Homeowners"],
    writes: FOOTPRINT.broad,
    mode: "connector",
  },
  {
    key: "transvale",
    name: "Transvale Insurance Company",
    naic: "90333",
    admitted: FOOTPRINT.broad,
    lines: ["Homeowners"],
    writes: FOOTPRINT.broad,
    mode: "connector",
  },
  {
    key: "southmere",
    writes: FOOTPRINT.southmere,
    name: "Southmere Specialty Insurance Company",
    naic: "90344",
    admitted: [],
    lines: ["Landlord"],
    mode: "file_feed",
  },
  {
    key: "hadrell",
    writes: FOOTPRINT.hadrell,
    name: "Hadrell Specialty Insurance Company",
    naic: "90355",
    admitted: [],
    lines: ["Landlord"],
    mode: "file_feed",
  },
  {
    key: "starfield",
    writes: FOOTPRINT.starfield,
    name: "Starfield Specialty Insurance Company",
    naic: "90366",
    admitted: [],
    lines: ["Landlord"],
    mode: "file_feed",
  },
];

const carrierName = (key: string) => CARRIERS.find((c) => c.key === key)!.name;

/** The carrier rates, binds, issues and processes changes through its API. */
export const CARRIER_OWNS = {
  transactions: {
    new_business: "carrier",
    endorsement: "carrier",
    cancellation: "carrier",
    reinstatement: "pas",
  },
  rating: "carrier",
  lineItems: "carrier",
  documents: { source: "both", order: "tenant_first" },
  policyNumber: "both",
  billing: "agency_bill",
};

/** PAS rates, issues and services the policy; the carrier lends its paper. */
export const PAS_OWNS = {
  transactions: {
    new_business: "pas",
    endorsement: "pas",
    cancellation: "pas",
    reinstatement: "pas",
  },
  rating: "pas",
  lineItems: "pas",
  documents: { source: "tenant", order: "tenant_first" },
  policyNumber: "pas",
  billing: "agency_bill",
};

export interface Program<T> {
  product: { key: string; name: string; lineOfBusiness: string };
  carrier: string;
  ownership: typeof CARRIER_OWNS | typeof PAS_OWNS;
  market: "admitted" | "non_admitted";
  jurisdictions: string[];
  config: T;
}

const evingtonRules = (form: "HO-3" | "HO-5") => [
  ...HOMEOWNERS_BASE_RULES,
  decline("Built before 1900", "DWELLING_AGE", "The dwelling's age isn't eligible", {
    built: "< 1900",
  }),
  decline("Vacant", "VACANT", "Vacant dwellings aren't eligible", { vacant: "true" }),
  decline("Short-term rental", "SHORT_TERM_RENTAL", "Short-term rentals aren't eligible", {
    str: "true",
  }),
  decline("Under construction", "CONSTRUCTION", "Dwellings under construction aren't eligible", {
    building: "true",
  }),
  decline("Livestock", "FARM_EXPOSURE", "Farm exposures aren't eligible", { livestock: "true" }),
  decline("Home business", "HOME_BUSINESS", "Homes with a home-based business aren't eligible", {
    business: "true",
  }),
  decline(
    "More than 3 claims",
    "LOSS_HISTORY",
    "The property isn't eligible based on loss history",
    { claims: "> 3" },
  ),
  decline(
    "Single loss over $100,000",
    "LOSS_HISTORY",
    "The property isn't eligible based on loss history",
    { largest: "> 100000" },
  ),
  decline(
    "Lapse over 90 days, not a first-time buyer",
    "PRIOR_LAPSE",
    "The prior insurance lapse isn't eligible",
    {
      lapse: "> 90",
      firstTime: "false",
    },
  ),
  decline(
    "Replacement cost under $75,000",
    "RCE_MINIMUM",
    "The dwelling's replacement cost isn't eligible",
    { rc: "< 75000" },
  ),
  decline(
    "Replacement cost $4M or more",
    "RCE_MAXIMUM",
    "The dwelling's replacement cost isn't eligible",
    { rc: ">= 4000000" },
  ),
  decline(
    "Primary residence under $100,000",
    "RCE_MINIMUM",
    "The dwelling's replacement cost isn't eligible",
    {
      rc: "< 100000",
      primary: "true",
    },
  ),
  ...(form === "HO-5"
    ? [
        decline(
          "HO-5 under $500,000",
          "FORM_MINIMUM",
          "The HO-5 form needs a replacement cost of $500,000 or more",
          { rc: "< 500000" },
        ),
      ]
    : []),
];

const apiCarrierRules = (options: {
  maxClaims: number;
  maxReplacementCost: number;
  minimum: number;
  townhomes: boolean;
  alarmsAbove?: number;
}) => [
  ...HOMEOWNERS_BASE_RULES,
  ...(options.townhomes
    ? []
    : [
        decline("Townhomes", "TOWNHOME", "This property type isn't eligible", {
          townhouse: "true",
        }),
      ]),
  decline("Open claim", "OPEN_CLAIM", "The property isn't eligible with an open claim", {
    open: "> 0",
  }),
  decline(
    "Negligent liability loss",
    "LIABILITY_LOSS",
    "The property isn't eligible based on loss history",
    { liabilityLosses: ">= 1" },
  ),
  decline(
    "Single loss over $100,000",
    "LOSS_HISTORY",
    "The property isn't eligible based on loss history",
    { largest: "> 100000" },
  ),
  decline(
    `More than ${options.maxClaims} claims`,
    "LOSS_HISTORY",
    "The property isn't eligible based on loss history",
    {
      claims: `> ${options.maxClaims}`,
    },
  ),
  decline(
    "Insured value over the maximum",
    "TIV_MAXIMUM",
    "The dwelling's replacement cost isn't eligible",
    {
      rc: `> ${options.maxReplacementCost}`,
    },
  ),
  decline(
    "Replacement cost under the form minimum",
    "RCE_MINIMUM",
    "The dwelling's replacement cost isn't eligible",
    {
      rc: `< ${options.minimum}`,
    },
  ),
  ...(options.alarmsAbove
    ? [
        decline(
          "High value without a central burglar alarm",
          "ALARM_REQUIRED",
          "A central station burglar alarm is required",
          {
            rc: `> ${options.alarmsAbove}`,
            burglarAlarm: "false",
          },
        ),
        decline(
          "High value without a central fire alarm",
          "ALARM_REQUIRED",
          "A central station fire alarm is required",
          {
            rc: `> ${options.alarmsAbove}`,
            fireAlarm: "false",
          },
        ),
      ]
    : []),
];

function homeowners(
  carrier: string,
  form: "HO-3" | "HO-5",
  market: Program<HomeownersProgram>["market"],
  config: Omit<
    HomeownersProgram,
    "key" | "name" | "carrier" | "issuer" | "form" | "market" | "inspections"
  >,
): Program<HomeownersProgram> {
  const key = `${form.toLowerCase().replace("-", "")}-${carrier}`;
  const name = `Homeowners ${form} · ${carrierName(carrier).replace(/ (Specialty )?Insurance Company$/, "")}`;

  return {
    product: { key, name, lineOfBusiness: "Homeowners" },
    carrier,
    ownership: CARRIER_OWNS,
    market,
    jurisdictions: FOOTPRINT.broad,
    config: {
      key,
      name,
      carrier,
      issuer: carrierName(carrier),
      form,
      market,
      inspections: STANDARD_INSPECTIONS,
      ...config,
    },
  };
}

function landlord(
  carrier: string,
  jurisdictions: string[],
  config: Omit<LandlordProgram, "key" | "name" | "carrier" | "issuer" | "market">,
): Program<LandlordProgram> {
  const key = `dp3-${carrier}`;
  const name = `Landlord DP-3 · ${carrierName(carrier).replace(/ (Specialty )?Insurance Company$/, "")}`;

  return {
    product: { key, name, lineOfBusiness: "Landlord" },
    carrier,
    ownership: PAS_OWNS,
    market: "non_admitted",
    jurisdictions,
    config: { key, name, carrier, issuer: carrierName(carrier), market: "non_admitted", ...config },
  };
}

const EVINGTON_HO = {
  liability: { options: [25000, 50000, 100000, 300000, 500000, 1000000], selected: 500000 },
  medicalPayments: { options: [1000, 5000, 10000], selected: 1000 },
  deductibles: { options: [1000, 2500, 5000, 10000], selected: 2500 },
  waterBackup: [25000],
  equipmentBreakdown: true,
  rates: { frameAtClassOne: 3.0, perClass: 0.35, minimumPremium: 500 },
  carrierAttestations: true,
};

const MSI_HO = {
  liability: { options: [100000, 300000, 500000], selected: 500000 },
  medicalPayments: { options: [1000, 5000], selected: 5000 },
  deductibles: { options: [2500, 5000, 7500, 10000, 25000], selected: 2500 },
  waterBackup: [10000, 25000],
  carrierAttestations: false,
};

export const HOMEOWNERS_PROGRAMS: Program<HomeownersProgram>[] = [
  homeowners("evington", "HO-3", "non_admitted", {
    ...EVINGTON_HO,
    underwriting: evingtonRules("HO-3"),
  }),
  homeowners("evington", "HO-5", "non_admitted", {
    ...EVINGTON_HO,
    underwriting: evingtonRules("HO-5"),
  }),
  homeowners("spindrift", "HO-3", "admitted", {
    ...MSI_HO,
    equipmentBreakdown: true,
    rates: { frameAtClassOne: 2.8, perClass: 0.32, minimumPremium: 450 },
    underwriting: apiCarrierRules({
      maxClaims: 2,
      maxReplacementCost: 2400000,
      minimum: 150000,
      townhomes: true,
    }),
  }),
  homeowners("spindrift", "HO-5", "admitted", {
    ...MSI_HO,
    equipmentBreakdown: false,
    rates: { frameAtClassOne: 2.8, perClass: 0.32, minimumPremium: 450 },
    underwriting: apiCarrierRules({
      maxClaims: 2,
      maxReplacementCost: 2400000,
      minimum: 500000,
      townhomes: true,
    }),
  }),
  homeowners("transvale", "HO-3", "admitted", {
    ...MSI_HO,
    equipmentBreakdown: true,
    rates: { frameAtClassOne: 2.9, perClass: 0.33, minimumPremium: 450 },
    underwriting: apiCarrierRules({
      maxClaims: 3,
      maxReplacementCost: 4000000,
      minimum: 300000,
      townhomes: false,
      alarmsAbove: 2400000,
    }),
  }),
  homeowners("transvale", "HO-5", "admitted", {
    ...MSI_HO,
    equipmentBreakdown: false,
    rates: { frameAtClassOne: 2.9, perClass: 0.33, minimumPremium: 450 },
    underwriting: apiCarrierRules({
      maxClaims: 3,
      maxReplacementCost: 4000000,
      minimum: 500000,
      townhomes: false,
      alarmsAbove: 2400000,
    }),
  }),
];

const southmereHadrellRules = [
  ...LANDLORD_BASE_RULES,
  decline("More than 3 stories", "TOO_MANY_STORIES", "Buildings over 3 stories aren't eligible", {
    stories: "> 3",
  }),
  decline("Condos", "DWELLING_TYPE", "Condos aren't eligible", { condo: "true" }),
  decline("Roof older than 25 years", "ROOF_AGE", "The roof is too old", { roof: "> 25" }),
  decline("Built before 1925", "DWELLING_AGE", "Buildings built before 1925 aren't eligible", {
    built: "< 1925",
  }),
  decline("Log construction", "LOG_CONSTRUCTION", "Log construction isn't eligible", {
    log: "true",
  }),
];

export const LANDLORD_PROGRAMS: Program<LandlordProgram>[] = [
  landlord("evington", FOOTPRINT.broad, {
    liability: { options: [500000, 1000000], selected: 500000 },
    deductibles: { options: [2500, 5000, 10000], selected: 5000 },
    rates: { frameAtClassOne: 3.4, perClass: 0.4, minimumPremium: 600 },
    underwriting: [
      ...LANDLORD_BASE_RULES,
      decline("Condos", "DWELLING_TYPE", "Condos aren't eligible", { condo: "true" }),
      decline("Log construction", "LOG_CONSTRUCTION", "Log construction isn't eligible", {
        log: "true",
      }),
    ],
  }),
  landlord("southmere", FOOTPRINT.southmere, {
    liability: { options: [300000, 500000, 1000000], selected: 500000 },
    deductibles: { options: [1000, 2500, 5000, 10000], selected: 2500 },
    rates: { frameAtClassOne: 3.3, perClass: 0.38, minimumPremium: 550 },
    underwriting: southmereHadrellRules,
  }),
  landlord("hadrell", FOOTPRINT.hadrell, {
    detailedReplacementCost: true,
    liability: { options: [300000, 500000, 1000000], selected: 500000 },
    deductibles: { options: [1000, 2500, 5000, 10000], selected: 2500 },
    rates: { frameAtClassOne: 3.25, perClass: 0.37, minimumPremium: 550 },
    underwriting: southmereHadrellRules,
  }),
  landlord("starfield", FOOTPRINT.starfield, {
    liability: { options: [500000, 1000000], selected: 1000000 },
    deductibles: { options: [2500, 5000, 10000], selected: 5000 },
    rates: { frameAtClassOne: 3.5, perClass: 0.42, minimumPremium: 650 },
    underwriting: [
      ...LANDLORD_BASE_RULES,
      decline("Log construction", "LOG_CONSTRUCTION", "Construction type can't be log", {
        log: "true",
      }),
      decline(
        "Wood shake or slate roof",
        "ROOF_COVERING",
        "Wood shake and slate roofs aren't eligible",
        {
          roofCovering: "true",
        },
      ),
      decline("Roof older than 25 years", "ROOF_AGE", "The roof is too old", { roof: "> 25" }),
    ],
  }),
];
