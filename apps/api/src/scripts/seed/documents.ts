const page = { size: "letter", margins: "normal" } as const;

export interface DocumentOptions {
  declarationsTitle: string;
  proposalIntro: string;
  locationColumns: { path: string; label: string }[];
  /** Plain-language notes shown on the declarations when a coverage is selected. */
  coverageNotes: { coverage: string; body: string }[];
  issuer: string;
  /** Replaces the standard replacement cost report template. */
  replacementCostReport?: object;
}

const cancellationClause = {
  key: "cancellation",
  title: "Cancellation and nonrenewal",
  body: "We may cancel this policy by mailing or delivering written notice to you at the mailing address shown in these declarations. If we cancel or don't renew, we'll tell you why and when coverage ends, and refund any unearned premium.",
  variants: [
    {
      title: "Cancellation and nonrenewal — Illinois",
      jurisdictions: ["US-IL"],
      body: "After this policy has been in effect for 60 days, we may cancel only for the reasons permitted by Illinois law, such as nonpayment of premium, misrepresentation, or a substantial change in the risk. We'll mail written notice to you and your agent at least 10 days before cancellation for nonpayment, and at least 60 days before cancellation for any other reason.\n\nIf we decide not to renew, we'll mail notice at least 60 days before the end of the policy period, stating the specific reason.",
    },
  ],
};

function declarations(options: DocumentOptions) {
  return {
    key: "declarations",
    kind: "declarations",
    title: options.declarationsTitle,
    page,
    blocks: [
      {
        id: "header",
        type: "header",
        title: "Declarations",
        subtitle: "Policy {{policy.number}}",
      },
      {
        id: "policy",
        type: "keyValue",
        columns: 2,
        rows: [
          { label: "Named insured", value: "{{namedInsured.name}}" },
          { label: "Policy number", value: "{{policy.number}}" },
          { label: "Mailing address", value: "{{namedInsured.mailingAddress}}" },
          { label: "Policy period", value: "{{policy.effectiveDate}} – {{policy.expirationDate}}" },
          { label: "Insurer", value: options.issuer },
          { label: "Producer", value: "{{producer.agency}}" },
          { label: "Date issued", value: "{{policy.issuedDate}}" },
        ],
      },
      {
        id: "period",
        type: "text",
        body: "The policy period begins and ends at 12:01 a.m. standard time at the residence premises.",
      },
      {
        id: "locations",
        type: "exposureTable",
        title: "Insured location",
        path: "locations",
        columns: options.locationColumns,
      },
      {
        id: "coverages",
        type: "coverageSchedule",
        title: "Coverages and limits",
        limit: true,
        deductible: true,
        premium: true,
      },
      ...options.coverageNotes.map((note) => ({
        id: `note_${note.coverage}`,
        type: "text",
        body: note.body,
        showWhen: `"${note.coverage}" in coverages`,
      })),
      { id: "forms", type: "formsSchedule", title: "Forms and endorsements" },
      { id: "cancellation", type: "clause", clause: "cancellation" },
      {
        id: "notice",
        type: "notice",
        title: "Please read your policy",
        body: "These declarations, together with the policy forms and endorsements listed above, complete your policy. Contact {{producer.agency}} at {{producer.phone}} with any questions.",
      },
      {
        id: "signature",
        type: "signature",
        name: "{{tenant.name}}",
        role: "Authorized representative",
        date: false,
      },
    ],
  };
}

function quoteProposal(options: DocumentOptions) {
  return {
    key: "quote_proposal",
    kind: "quote_proposal",
    title: "Quote proposal",
    page,
    blocks: [
      {
        id: "header",
        type: "header",
        title: "Quote proposal",
        subtitle: "Prepared {{policy.issuedDate}}",
      },
      {
        id: "intro",
        type: "text",
        body: `Dear {{namedInsured.name}},\n\n${options.proposalIntro}`,
      },
      {
        id: "summary",
        type: "keyValue",
        columns: 2,
        rows: [
          { label: "Applicant", value: "{{namedInsured.name}}" },
          { label: "Proposed effective date", value: "{{policy.effectiveDate}}" },
          { label: "Property", value: "{{risk.locations[0].address}}" },
          { label: "Insurer", value: options.issuer },
          { label: "Agent", value: "{{producer.name}}, {{producer.agency}}" },
        ],
      },
      {
        id: "coverages",
        type: "coverageSchedule",
        title: "Proposed coverages",
        limit: true,
        deductible: true,
        premium: true,
      },
      {
        id: "binder",
        type: "notice",
        title: "This proposal is not a binder",
        body: "Coverage isn't in force until the policy is bound and you receive confirmation. Rates and eligibility are subject to underwriting review.",
      },
      {
        id: "signature",
        type: "signature",
        name: "{{namedInsured.name}}",
        role: "Applicant",
        date: true,
      },
    ],
  };
}

const cancellationNotice = {
  key: "cancellation_notice",
  kind: "notice",
  title: "Notice of cancellation",
  page,
  blocks: [
    {
      id: "header",
      type: "header",
      title: "{{notice.title}}",
      subtitle: "Policy {{policy.number}} · {{policy.jurisdiction}}",
    },
    {
      id: "facts",
      type: "keyValue",
      columns: 2,
      rows: [
        { label: "Named insured", value: "{{namedInsured.name}}" },
        { label: "Mailing address", value: "{{namedInsured.mailingAddress}}" },
        { label: "Policy period", value: "{{policy.effectiveDate}} – {{policy.expirationDate}}" },
        { label: "Notice date", value: "{{notice.noticeDate}}" },
        {
          label: "Cancellation effective",
          value: "{{notice.effectiveDate}} at 12:01 a.m. standard time",
        },
        { label: "Reason", value: "{{notice.reason}}" },
        { label: "Return premium", value: "{{notice.returnPremium}}" },
        { label: "Producer", value: "{{producer.name}}" },
      ],
    },
    {
      id: "body",
      type: "text",
      body: "We are cancelling policy {{policy.number}} effective {{notice.effectiveDate}} at 12:01 a.m. This notice is given at least {{notice.minDaysNotice}} days before that date, as required in {{policy.jurisdiction}}. Coverage ends on the effective date. Any unearned premium will be refunded to the original payment method.",
    },
    {
      id: "rights",
      type: "notice",
      title: "Your rights",
      body: "If you have questions about this cancellation, contact your producer or {{tenant.name}} at {{tenant.supportEmail}}. You may also contact your state department of insurance.",
    },
  ],
};

export const replacementCostReport = {
  key: "rce_report",
  kind: "enrichment_report",
  title: "Estimated replacement cost report",
  page,
  blocks: [
    {
      id: "header",
      type: "header",
      title: "Estimated replacement cost report",
      subtitle: "{{product.name}}",
    },
    {
      id: "building",
      type: "keyValue",
      title: "Building",
      columns: 2,
      rows: [
        { label: "Address", value: "{{risk.locations[0].address}}" },
        { label: "Year built", value: "{{risk.locations[0].yearBuilt}}" },
        { label: "Square feet", value: "{{enrichment.call.rce.squareFeet}}" },
        { label: "Quality", value: "{{enrichment.call.rce.quality}}" },
        { label: "Cost per square foot", value: "{{enrichment.call.rce.costPerSquareFoot}}" },
        { label: "Valuation", value: "{{enrichment.call.rce.valuationId}}" },
      ],
    },
    {
      id: "breakdown",
      type: "dataTable",
      title: "Cost breakdown",
      path: "enrichment.call.rce.breakdown",
      columns: [
        { path: "component", label: "Component" },
        { path: "amount", label: "Amount" },
      ],
      total: { path: "enrichment.call.rce.replacementCost", label: "Estimated replacement cost" },
    },
    {
      id: "disclaimer",
      type: "text",
      body: "This estimate is for insurance purposes only and isn't an appraisal.",
    },
  ],
};

export function documentSet(options: DocumentOptions) {
  return {
    templates: [
      declarations(options),
      quoteProposal(options),
      cancellationNotice,
      options.replacementCostReport ?? replacementCostReport,
    ],
    clauses: [cancellationClause],
    schedule: [
      {
        id: "declarations",
        order: 10,
        attachTo: ["new_business", "renewal", "endorsement"],
        document: { kind: "template", key: "declarations" },
      },
      {
        id: "quote_proposal",
        order: 10,
        attachTo: ["quote"],
        document: { kind: "template", key: "quote_proposal" },
      },
      {
        id: "cancellation_notice",
        order: 5,
        attachTo: ["cancellation"],
        document: { kind: "template", key: "cancellation_notice" },
      },
    ],
  };
}

export const BILLING = {
  methods: ["direct", "agency", "mortgagee"],
  defaultPlan: "full",
  dunning: { retries: 1, retryAfterDays: 3, delinquencySource: "pas", reminderAfterDays: 1 },
  mortgagee: {
    dueDays: 30,
    reminderDays: [15, 30],
    nonpaymentAfterDays: 45,
    offerDirectAfterDays: 30,
  },
  payPlans: [
    {
      key: "full",
      label: "Pay in full",
      installments: 1,
      intervalMonths: 12,
      downPayment: { kind: "first_installment" },
      installmentFee: null,
      taxesFees: "up_front",
      graceDays: 10,
      dueDaysBefore: 0,
      billDaysBeforeDue: 14,
      eligibility: { mortgageeBilling: true },
    },
    {
      key: "semi_annual",
      label: "Semi-annual",
      installments: 2,
      intervalMonths: 6,
      downPayment: { kind: "first_installment" },
      installmentFee: null,
      taxesFees: "up_front",
      graceDays: 10,
      dueDaysBefore: 0,
      billDaysBeforeDue: 14,
      eligibility: {},
    },
    {
      key: "quarterly",
      label: "Quarterly",
      installments: 4,
      intervalMonths: 3,
      downPayment: { kind: "first_installment" },
      installmentFee: "5",
      taxesFees: "up_front",
      graceDays: 10,
      dueDaysBefore: 0,
      billDaysBeforeDue: 14,
      eligibility: {},
    },
    {
      key: "monthly",
      label: "Monthly 10-pay",
      installments: 10,
      intervalMonths: 1,
      downPayment: { kind: "percent", percent: "20" },
      installmentFee: "5",
      taxesFees: "up_front",
      graceDays: 10,
      dueDaysBefore: 0,
      billDaysBeforeDue: 10,
      eligibility: { minPremium: "1000" },
    },
  ],
};

/** A carrier's replacement cost estimate: the building, the valuation and every cost component. */
export function detailedReplacementCostReport(issuer: string) {
  const rce = "enrichment.call.rce";
  const location = "risk.locations[0]";

  return {
    key: "rce_report",
    kind: "enrichment_report",
    title: "Replacement cost estimate",
    page,
    blocks: [
      {
        id: "header",
        type: "header",
        title: "Replacement cost estimate",
        subtitle: `${issuer} · {{product.name}}`,
      },
      {
        id: "property",
        type: "keyValue",
        title: "Property",
        columns: 2,
        rows: [
          { label: "Address", value: `{{${location}.address}}` },
          { label: "Dwelling type", value: `{{${location}.dwellingType}}` },
          { label: "Units", value: `{{${location}.units}}` },
          { label: "Stories", value: `{{${location}.stories}}` },
          { label: "Year built", value: `{{${location}.yearBuilt}}` },
          { label: "Construction", value: `{{${location}.construction}}` },
          { label: "Roof covering", value: `{{${location}.roofCovering}}` },
          { label: "Square feet", value: `{{${rce}.squareFeet}}` },
        ],
      },
      {
        id: "valuation",
        type: "keyValue",
        title: "Valuation",
        columns: 2,
        rows: [
          { label: "Valuation", value: `{{${rce}.valuationId}}` },
          { label: "Quality", value: `{{${rce}.quality}}` },
          { label: "Cost per square foot", value: `{{${rce}.costPerSquareFoot}}` },
          { label: "Estimated replacement cost", value: `{{${rce}.replacementCost}}` },
          { label: "Exclusions", value: `{{${rce}.exclusions}}` },
          { label: "Insurable replacement cost", value: `{{${rce}.insurableReplacementCost}}` },
          { label: "Suggested dwelling limit", value: "{{enrichment.derived.dwellingValue}}" },
        ],
      },
      {
        id: "breakdown",
        type: "dataTable",
        title: "Cost breakdown",
        path: `${rce}.breakdown`,
        rowWhen: "$.excluded != true",
        columns: [
          { path: "component", label: "Component" },
          { path: "amount", label: "Amount" },
        ],
        total: { path: `${rce}.insurableReplacementCost`, label: "Insurable replacement cost" },
      },
      {
        id: "exclusions",
        type: "dataTable",
        title: "Excluded from the insurable value",
        path: `${rce}.breakdown`,
        rowWhen: "$.excluded == true",
        columns: [
          { path: "component", label: "Component" },
          { path: "amount", label: "Amount" },
        ],
        total: { path: `${rce}.exclusions`, label: "Total exclusions" },
      },
      {
        id: "basis",
        type: "notice",
        title: "How this estimate is used",
        body: "The dwelling limit is set from the insurable replacement cost, rounded to the nearest $1,000. Changes to square footage, quality, construction or stories change the estimate.",
      },
      {
        id: "disclaimer",
        type: "text",
        body: "This estimate is for insurance purposes only and isn't an appraisal.",
      },
    ],
  };
}
