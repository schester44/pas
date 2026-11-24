import { col, decision, list, outputs, type Row, table, text } from "./decisions";

const state = col("state", "jurisdiction.subdivision", "State");
const market = col("market", "market", "Market");

const SL_TAX: Record<string, string> = {
  AL: "0.06",
  OK: "0.06",
  SC: "0.06",
  MO: "0.05",
  NJ: "0.05",
  NC: "0.05",
  OH: "0.05",
  TN: "0.05",
  FL: "0.0494",
  LA: "0.0485",
  TX: "0.0485",
  WV: "0.0455",
  UT: "0.0425",
  AR: "0.04",
  CT: "0.04",
  GA: "0.04",
  MA: "0.04",
  MS: "0.04",
  RI: "0.04",
  IL: "0.035",
  NV: "0.035",
  NM: "0.03003",
  WA: "0.03003",
  AZ: "0.03",
  CA: "0.03",
  CO: "0.03",
  DE: "0.03",
  KS: "0.03",
  KY: "0.03",
  MD: "0.03",
  ME: "0.03",
  MN: "0.03",
  NE: "0.03",
  NH: "0.03",
  PA: "0.03",
  VT: "0.03",
  WI: "0.03",
  WY: "0.03",
  MT: "0.0275",
  IN: "0.025",
  SD: "0.025",
  VA: "0.0225",
  DC: "0.02",
  MI: "0.02",
  OR: "0.02",
  ND: "0.0175",
  ID: "0.015",
  IA: "0.0095",
};

/** Whole-dollar rounding where the state's tax form calls for it. */
const WHOLE_DOLLAR_STATES = new Set(["IL", "ID"]);

interface FeeLine {
  code: string;
  label: string;
  rate?: string;
  amount?: string;
}

const STATE_FEES: Record<string, FeeLine[]> = {
  AZ: [{ code: "STAMPING_FEE", label: "Stamping fee", rate: "0.002" }],
  CA: [{ code: "STAMPING_FEE", label: "Stamping fee", rate: "0.0018" }],
  CO: [{ code: "SLAS_FEE", label: "SLAS clearinghouse fee", rate: "0.00175" }],
  FL: [
    { code: "FSLO_FEE", label: "FSLO service fee", rate: "0.0006" },
    { code: "EMPA_SURCHARGE", label: "EMPA surcharge", amount: "2" },
  ],
  ID: [{ code: "STAMPING_FEE", label: "Stamping fee", rate: "0.005" }],
  IL: [
    { code: "STAMPING_FEE", label: "Stamping fee", rate: "0.0004" },
    { code: "FIRE_MARSHAL_TAX", label: "Fire marshal tax", rate: "0.004" },
  ],
  KY: [{ code: "SURCHARGE", label: "Surcharge (1.8%)", rate: "0.018" }],
  MI: [{ code: "REGULATORY_FEE", label: "Regulatory fee", rate: "0.005" }],
  MN: [{ code: "STAMPING_FEE", label: "Stamping fee", rate: "0.0004" }],
  MS: [
    { code: "STAMPING_FEE", label: "Stamping fee", rate: "0.0025" },
    { code: "MWUA_FEE", label: "MWUA fee", rate: "0.03" },
  ],
  MT: [{ code: "FIRE_MARSHAL_TAX", label: "Fire marshal tax", rate: "0.01" }],
  NC: [{ code: "STAMPING_FEE", label: "Stamping fee", rate: "0.003" }],
  NV: [{ code: "FILING_FEE", label: "Filing fee", rate: "0.004" }],
  OK: [{ code: "SLAS_FEE", label: "SLAS clearinghouse fee", rate: "0.00175" }],
  OR: [
    { code: "FIRE_MARSHAL_TAX", label: "Fire marshal tax", rate: "0.003" },
    { code: "SL_SERVICE_CHARGE", label: "Surplus lines service charge", amount: "10" },
  ],
  PA: [{ code: "STAMPING_FEE", label: "Stamping fee", amount: "20" }],
  SD: [
    { code: "FIRE_MARSHAL_TAX", label: "Fire marshal tax", rate: "0.00175" },
    { code: "SLAS_FEE", label: "SLAS clearinghouse fee", rate: "0.00175" },
  ],
  TN: [{ code: "SLAS_FEE", label: "SLAS clearinghouse fee", rate: "0.00175" }],
  TX: [{ code: "STAMPING_FEE", label: "Stamping fee", rate: "0.0004" }],
  UT: [{ code: "STAMPING_FEE", label: "Stamping fee", rate: "0.0018" }],
  VA: [{ code: "STATE_ASSESSMENT", label: "State assessment", rate: "0.00025" }],
  WA: [{ code: "STAMPING_FEE", label: "Stamping fee", rate: "0.003" }],
  WY: [{ code: "SLAS_FEE", label: "SLAS clearinghouse fee", rate: "0.00175" }],
};

/** Where the broker fee is itself taxed, so the premium tax applies to premium and fees. */
const TAXABLE_BROKER_FEE = new Set([
  "AL",
  "AR",
  "AZ",
  "DC",
  "FL",
  "GA",
  "ID",
  "KS",
  "ME",
  "MN",
  "MO",
  "MS",
  "ND",
  "NM",
  "NV",
  "OK",
  "OR",
  "SC",
  "TN",
  "TX",
  "UT",
  "VA",
  "WA",
  "WI",
  "WY",
]);

export interface BrokerFees {
  amount: (state: string) => string | null;
}

/** Homeowners broker fees: $50 in Montana and New Jersey, $100 elsewhere it's charged. */
export const HOMEOWNERS_BROKER_FEES: BrokerFees = {
  amount: (s) =>
    ["MT", "NJ"].includes(s)
      ? "50"
      : SL_TAX[s] && !["CO", "DE", "IA", "IN", "KY", "NH", "SD", "VT", "WV"].includes(s)
        ? "100"
        : null,
};

/** Landlord broker fees are a flat $50 where they're charged. */
export const LANDLORD_BROKER_FEES: BrokerFees = {
  amount: (s) => (["IL", "OH", "TX", "GA", "AZ"].includes(s) ? "50" : null),
};

const taxRow = (s: string, line: FeeLine & { basis: string; taxable: boolean }): Row => ({
  _description: `${s}: ${line.label.toLowerCase()}`,
  state: text(`US-${s}`),
  market: text("non_admitted"),
  code: text(`${s}_${line.code}`),
  label: text(line.label),
  rate: line.rate ?? "",
  amount: line.amount ? text(line.amount) : "",
  currency: line.amount ? text("USD") : "",
  basis: text(line.amount ? "flat" : line.basis),
  taxable: String(line.taxable),
  remitter: text("licensee"),
  ...(WHOLE_DOLLAR_STATES.has(s) && line.rate ? { rounding: text("half_up"), places: "0" } : {}),
});

/** Surplus lines premium tax, stamping and state fees, plus the program's broker fee. */
export function taxesAndFees(brokerFees: BrokerFees) {
  const rows = Object.entries(SL_TAX).flatMap(([s, rate]) => {
    const fee = brokerFees.amount(s);
    const feeTaxed = fee !== null && TAXABLE_BROKER_FEE.has(s);

    return [
      taxRow(s, {
        code: "SL_TAX",
        label: "Surplus lines tax",
        rate,
        basis: feeTaxed ? "premium_and_fees" : "premium",
        taxable: false,
      }),
      ...(STATE_FEES[s] ?? []).map((line) =>
        taxRow(s, { ...line, basis: "premium", taxable: false }),
      ),
      ...(fee
        ? [
            taxRow(s, {
              code: "BROKER_FEE",
              label: "Broker fee",
              amount: fee,
              basis: "flat",
              taxable: feeTaxed,
            }),
          ]
        : []),
    ];
  });

  return decision(
    "taxes_fees",
    "Surplus lines taxes and fees",
    table(
      "Surplus lines taxes and fees",
      [state, market],
      outputs(
        "code",
        "label",
        "rate",
        "amount",
        "currency",
        "basis",
        "taxable",
        "remitter",
        "rounding",
        "places",
      ),
      rows,
    ),
  );
}

/** Declinations each state's diligent search requires; 0 means no search. */
const DECLINATIONS: Record<string, number> = {
  AL: 3,
  AR: 3,
  AZ: 3,
  CA: 3,
  CO: 3,
  CT: 3,
  DC: 3,
  DE: 3,
  FL: 0,
  GA: 3,
  IA: 3,
  ID: 3,
  IL: 3,
  IN: 3,
  KS: 3,
  KY: 3,
  LA: 0,
  MA: 1,
  MD: 3,
  ME: 3,
  MI: 3,
  MN: 3,
  MO: 3,
  MS: 0,
  MT: 3,
  NC: 3,
  ND: 3,
  NE: 3,
  NH: 3,
  NJ: 3,
  NM: 3,
  NV: 3,
  OH: 5,
  OK: 3,
  OR: 1,
  PA: 1,
  RI: 3,
  SC: 3,
  SD: 3,
  TN: 3,
  TX: 3,
  UT: 3,
  VA: 0,
  VT: 3,
  WA: 3,
  WI: 0,
  WV: 3,
  WY: 3,
};

/** Illinois files the affidavit with SLAI after binding; elsewhere declinations come first. */
const AFFIDAVIT_STATES = new Set(["IL"]);

export function diligentSearch() {
  const rows: Row[] = [
    {
      _description: "Admitted business needs no search",
      market: text("admitted"),
      required: "false",
      declinationsRequired: "0",
      exemptions: "[]",
    },
    ...Object.entries(DECLINATIONS).map(([s, count]): Row => {
      if (count === 0) {
        return {
          _description: `${s}: no declinations required`,
          state: text(`US-${s}`),
          market: text("non_admitted"),
          required: "false",
          declinationsRequired: "0",
          exemptions: "[]",
        };
      }

      const affidavit = AFFIDAVIT_STATES.has(s);

      return {
        _description: `${s}: ${count} declination${count === 1 ? "" : "s"}${affidavit ? ", affidavit filed after binding" : ""}`,
        state: text(`US-${s}`),
        market: text("non_admitted"),
        required: "true",
        declinationsRequired: String(count),
        timing: text(affidavit ? "post_bind" : "pre_bind"),
        exemptions: "[]",
        ...(affidavit && { fileAffidavit: "true" }),
      };
    }),
  ];

  return decision(
    "dea",
    "Diligent search requirements",
    table(
      "Diligent search requirements",
      [state, market],
      outputs("required", "declinationsRequired", "timing", "exemptions", "fileAffidavit"),
      rows,
      "first",
    ),
    [
      {
        id: "dea-oh-style",
        name: "Indiana needs three declinations before binding",
        input: { market: "non_admitted", jurisdiction: { country: "US", subdivision: "US-IN" } },
        expected: {
          required: true,
          declinationsRequired: 3,
          timing: "pre_bind",
          exemptions: [],
        },
      },
    ],
  );
}

const notice = (
  s: string,
  description: string,
  cells: {
    reason?: string;
    age?: string;
    days: number;
    mailing: number;
    allowed?: string[];
    delivery: string;
    mortgagee: boolean;
    stateReason: boolean;
  },
): Row => ({
  _description: description,
  state: text(s),
  reason: cells.reason ? text(cells.reason) : "",
  age: cells.age ?? "",
  minDaysNotice: String(cells.days),
  mailingDaysAdded: String(cells.mailing),
  allowedReasons: list(cells.allowed ?? []),
  deliveryMethods: list([cells.delivery]),
  recipients: list(
    cells.mortgagee ? ["insured", "producer", "mortgagee"] : ["insured", "producer"],
  ),
  mustStateReason: String(cells.stateReason),
});

const LIMITED = ["nonpayment", "misrepresentation", "underwriting"];
const MAIL = "first_class_mail_with_certificate";

export function noticeRules() {
  return decision(
    "notice_rules",
    "Cancellation notice rules",
    table(
      "Cancellation notice rules",
      [
        state,
        col("reason", "notice.reason", "Reason"),
        col("age", "notice.policyAgeDays", "Policy age (days)"),
      ],
      outputs(
        "minDaysNotice",
        "mailingDaysAdded",
        "allowedReasons",
        "deliveryMethods",
        "recipients",
        "mustStateReason",
      ),
      [
        notice("US-IL", "Insured may cancel immediately", {
          reason: "insured_request",
          days: 0,
          mailing: 0,
          delivery: "electronic",
          mortgagee: false,
          stateReason: false,
        }),
        notice("US-IL", "215 ILCS 5/143.16: 10 days for nonpayment", {
          reason: "nonpayment",
          days: 10,
          mailing: 0,
          delivery: MAIL,
          mortgagee: true,
          stateReason: true,
        }),
        notice("US-IL", "New business period: any reason, 30 days", {
          age: "< 60",
          days: 30,
          mailing: 0,
          delivery: MAIL,
          mortgagee: true,
          stateReason: true,
        }),
        notice("US-IL", "After 60 days: limited reasons, 60 days", {
          age: ">= 60",
          days: 60,
          mailing: 0,
          allowed: LIMITED,
          delivery: MAIL,
          mortgagee: true,
          stateReason: true,
        }),
        notice("US-IN", "Insured may cancel immediately", {
          reason: "insured_request",
          days: 0,
          mailing: 0,
          delivery: "electronic",
          mortgagee: false,
          stateReason: false,
        }),
        notice("US-IN", "10 days plus 3 for mailing", {
          reason: "nonpayment",
          days: 10,
          mailing: 3,
          delivery: MAIL,
          mortgagee: true,
          stateReason: true,
        }),
        notice("US-IN", "New business period: 20 days plus mailing", {
          age: "< 60",
          days: 20,
          mailing: 3,
          delivery: MAIL,
          mortgagee: true,
          stateReason: true,
        }),
        notice("US-IN", "After 60 days: limited reasons, 45 days", {
          age: ">= 60",
          days: 45,
          mailing: 3,
          allowed: LIMITED,
          delivery: MAIL,
          mortgagee: true,
          stateReason: true,
        }),
      ],
      "first",
    ),
  );
}

const cancellationRow = (s: string): Row => ({
  _description: "25% minimum earned on insured and nonpayment cancellations",
  state: text(s),
  method: text("pro_rata"),
  minimumEarnedType: text("percent"),
  minimumEarnedValue: text("25"),
  minimumEarnedLevel: text("policy"),
  minimumEarnedAppliesTo: list(["insured_request", "nonpayment"]),
  fullyEarnedFees: list([`${s.slice(3)}_BROKER_FEE`]),
});

export function cancellationTerms() {
  return decision(
    "cancellation_terms",
    "Cancellation terms",
    table(
      "Cancellation terms",
      [state],
      outputs(
        "method",
        "minimumEarnedType",
        "minimumEarnedValue",
        "minimumEarnedLevel",
        "minimumEarnedAppliesTo",
        "fullyEarnedFees",
      ),
      [cancellationRow("US-IL"), cancellationRow("US-IN")],
      "first",
    ),
  );
}

const filing = (
  home: string,
  type: string,
  cells: {
    code: string;
    kind?: string;
    title: string;
    channel: string;
    dueDays: number;
    dueFrom: string;
    businessDays: boolean;
    bearing?: boolean;
    affidavit?: boolean;
    description: string;
  },
): Row => ({
  _description: cells.description,
  market: text("non_admitted"),
  home: text(home),
  type: text(type),
  bearing: cells.bearing ? "true" : "",
  affidavit: cells.affidavit ? "true" : "",
  kind: text(cells.kind ?? "sl_filing"),
  code: text(cells.code),
  title: text(cells.title),
  dueDays: String(cells.dueDays),
  dueFrom: text(cells.dueFrom),
  businessDays: String(cells.businessDays),
  channel: text(cells.channel),
  responsible: text("licensee"),
  remindDays: "14",
  escalateDays: "7",
});

export function filingObligations() {
  const il = (type: string, description: string, dueFrom = "later_of_effective_issue") =>
    filing("US-IL", type, {
      code: "IL_SL_FILING",
      title: "Illinois surplus lines filing",
      channel: "api",
      dueDays: 90,
      dueFrom,
      businessDays: false,
      bearing: type === "endorsement",
      description,
    });

  const indiana = (type: string, description: string) =>
    filing("US-IN", type, {
      code: "IN_SL_FILING",
      title: "Indiana surplus lines filing",
      channel: "file_export",
      dueDays: 20,
      dueFrom: "later_of_effective_issue",
      businessDays: true,
      bearing: type === "endorsement",
      description,
    });

  return decision(
    "filing_obligations",
    "Surplus lines filings",
    table(
      "Surplus lines filings",
      [
        market,
        col("home", "homeState", "Home state"),
        col("type", "transaction.type", "Transaction"),
        col("bearing", "transaction.premiumBearing", "Premium bearing"),
        col("affidavit", "diligentSearch.fileAffidavit", "Affidavit"),
      ],
      outputs(
        "kind",
        "code",
        "title",
        "dueDays",
        "dueFrom",
        "businessDays",
        "channel",
        "responsible",
        "remindDays",
        "escalateDays",
      ),
      [
        il("new_business", "New business", "effective"),
        il("endorsement", "Premium-bearing endorsements"),
        il("cancellation", "Cancellations"),
        il("reinstatement", "Reinstatements"),
        filing("US-IL", "new_business", {
          code: "IL_SL_AFFIDAVIT",
          kind: "sl_affidavit",
          title: "Illinois diligent search affidavit",
          channel: "api",
          dueDays: 90,
          dueFrom: "effective",
          businessDays: false,
          affidavit: true,
          description: "Affidavit filed with the policy",
        }),
        indiana("new_business", "New business"),
        indiana("endorsement", "Premium-bearing endorsements"),
        indiana("cancellation", "Cancellations"),
        indiana("reinstatement", "Reinstatements"),
      ],
    ),
  );
}

const reportingRow = (
  home: string,
  cells: { code: string; title: string; frequency: string; dueDays: number; description: string },
): Row => ({
  _description: cells.description,
  home: text(home),
  report: text("sl_filing"),
  kind: text("sl_remittance"),
  code: text(cells.code),
  title: text(cells.title),
  frequency: text(cells.frequency),
  aggregates: text("sl_filing"),
  dueDays: String(cells.dueDays),
  channel: text("file_export"),
  responsible: text("licensee"),
  remindDays: "14",
  escalateDays: "7",
});

export function reportingObligations() {
  return decision(
    "reporting_obligations",
    "Surplus lines tax remittance",
    table(
      "Surplus lines tax remittance",
      [col("home", "homeState", "Home state"), col("report", "report.kind", "Report")],
      outputs(
        "kind",
        "code",
        "title",
        "frequency",
        "aggregates",
        "dueDays",
        "channel",
        "responsible",
        "remindDays",
        "escalateDays",
      ),
      [
        reportingRow("US-IL", {
          code: "IL_SL_TAX",
          title: "Illinois surplus lines tax statement",
          frequency: "semiannual",
          dueDays: 32,
          description: "Semiannual statements due Feb 1 and Aug 1",
        }),
        reportingRow("US-IN", {
          code: "IN_SL_TAX",
          title: "Indiana surplus lines tax report",
          frequency: "quarterly",
          dueDays: 30,
          description: "Quarterly report",
        }),
      ],
    ),
  );
}

export interface AttestationGroup {
  code: string;
  title: string;
  statement: string;
}

const bullets = (lead: string, items: readonly string[]) =>
  [lead, ...items.map((item) => `• ${item}`)].join("\n");

export const attestationGroup = (
  code: string,
  title: string,
  lead: string,
  items: readonly string[],
): AttestationGroup => ({ code, title, statement: bullets(lead, items) });

export function attestations(groups: readonly AttestationGroup[]) {
  const row = (group: AttestationGroup, onlyMarket?: string): Row => ({
    _description: group.title,
    market: onlyMarket ? text(onlyMarket) : "",
    code: text(group.code),
    title: text(group.title),
    statement: text(group.statement),
  });

  return decision(
    "attestations",
    "Bind attestations",
    table("Bind attestations", [market], outputs("code", "title", "statement"), [
      row({
        code: "APPLICATION_TRUE",
        title: "Application statements",
        statement:
          "The statements in this application are true and complete to the best of my knowledge, and I understand the policy is issued in reliance on them.",
      }),
      ...groups.map((group) => row(group)),
      row(
        {
          code: "SL_DISCLOSURE",
          title: "Surplus lines disclosure",
          statement:
            "This insurance is placed with a surplus lines insurer that is not licensed in your state. It is not protected by the state insurance guaranty fund.",
        },
        "non_admitted",
      ),
    ]),
  );
}

/** The compliance decisions every program carries; taxes only bite on non-admitted business. */
export function complianceDecisions(brokerFees: BrokerFees) {
  return [
    taxesAndFees(brokerFees),
    diligentSearch(),
    noticeRules(),
    cancellationTerms(),
    filingObligations(),
    reportingObligations(),
  ];
}
