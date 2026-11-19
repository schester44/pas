export type DownPayment = { kind: "first_installment" } | { kind: "percent"; percent: string };

export interface PayPlanEligibility {
  minPremium?: string;
  jurisdictions?: string[];
  channels?: string[];
  mortgageeBilling?: boolean;
  when?: string;
}

/** One way to pay a term's premium (PLAN §13): product config, copied into each release. */
export interface PayPlan {
  key: string;
  label: string;
  installments: number;
  intervalMonths: number;
  downPayment: DownPayment;
  installmentFee: string | null;
  taxesFees: "up_front" | "spread";
  dueDaysBefore: number;
  billDaysBeforeDue: number;
  graceDays: number;
  eligibility: PayPlanEligibility;
}

/**
 * Autopay retries, the reminder, and who decides an account is delinquent: PAS's own due-date and
 * grace tracking, or the billing system's `account.delinquent` event (PLAN §13).
 */
export interface Dunning {
  retryAfterDays: number;
  retries: number;
  reminderAfterDays: number;
  delinquencySource: "pas" | "billing_system";
}

export const BILLING_METHODS = ["direct", "agency", "mortgagee"] as const;

export type BillingMethodKey = (typeof BILLING_METHODS)[number];

/**
 * Mortgagee bill follow-ups, in days after the lender's invoice packet goes out (PLAN §13):
 * reminders to the lender, the insured offered direct bill, then nonpayment.
 */
export interface MortgageeFollowUp {
  dueDays: number;
  reminderDays: number[];
  offerDirectAfterDays: number;
  nonpaymentAfterDays: number;
}

export interface BillingConfig {
  payPlans: PayPlan[];
  defaultPlan: string | null;
  dunning: Dunning;
  methods: BillingMethodKey[];
  mortgagee: MortgageeFollowUp;
}

export function emptyBillingConfig(): BillingConfig {
  return {
    payPlans: [],
    defaultPlan: null,
    dunning: { retryAfterDays: 3, retries: 1, reminderAfterDays: 1, delinquencySource: "pas" },
    methods: ["direct"],
    mortgagee: {
      dueDays: 30,
      reminderDays: [15, 30],
      offerDirectAfterDays: 30,
      nonpaymentAfterDays: 45,
    },
  };
}

export function billingConfigOf(value: unknown): BillingConfig {
  const empty = emptyBillingConfig();
  const config = (value ?? {}) as Partial<BillingConfig>;

  return {
    payPlans: config.payPlans ?? empty.payPlans,
    defaultPlan: config.defaultPlan ?? null,
    dunning: { ...empty.dunning, ...config.dunning },
    methods: config.methods?.length ? config.methods : empty.methods,
    mortgagee: { ...empty.mortgagee, ...config.mortgagee },
  };
}
