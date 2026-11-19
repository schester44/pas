import type { BillingConfig, BillingMethodKey, PayPlan } from "@pas/pay-plans";
import type { AdditionalInterest, BindDetails } from "./bind-details";
import type { PayPlanOffer } from "./pay-plan-offers";

export interface BillingMethodOption {
  method: BillingMethodKey;
  available: boolean;
  reason: string | null;
  payer: { name: string; reference: string | null } | null;
  payPlan: string | null;
}

export const mortgageeOf = (details: BindDetails | null): AdditionalInterest | null =>
  details?.additionalInterests.find((i) => i.kind === "mortgagee" && i.name.trim()) ?? null;

/** The pay-in-full plan a payer other than the insured is billed on (PLAN §13). */
export function payInFullFor(
  method: BillingMethodKey,
  billing: BillingConfig,
  offers: readonly PayPlanOffer[],
  selected: string | null,
): PayPlan | null {
  const fits = (plan: PayPlan) =>
    plan.installments === 1 &&
    offers.some((o) => o.key === plan.key) &&
    (method !== "mortgagee" || plan.eligibility.mortgageeBilling === true);

  const plans = billing.payPlans.filter(fits);

  return plans.find((p) => p.key === selected) ?? plans[0] ?? null;
}

/**
 * The billing methods offered at bind: those the product allows, agency bill when the producer's
 * agency may bill this premium, mortgagee bill when a mortgagee is on the risk.
 */
export function billingMethodOptions(input: {
  billing: BillingConfig;
  offers: readonly PayPlanOffer[];
  selectedPlan: string | null;
  details: BindDetails | null;
  agency: {
    available: boolean;
    reason: string | null;
    agencyId: string | null;
    agencyName: string | null;
  } | null;
}): BillingMethodOption[] {
  return input.billing.methods.map((method): BillingMethodOption => {
    const plan =
      method === "direct"
        ? null
        : payInFullFor(method, input.billing, input.offers, input.selectedPlan);

    const base = { method, payPlan: plan?.key ?? null };

    if (method === "direct") return { ...base, available: true, reason: null, payer: null };

    if (!plan) {
      return {
        ...base,
        available: false,
        reason: "No pay-in-full plan is offered on this quote",
        payer: null,
      };
    }

    if (method === "agency") {
      const agency = input.agency;

      return {
        ...base,
        available: agency?.available ?? false,
        reason: agency ? agency.reason : "The producer has no agency of record",
        payer: agency?.agencyName ? { name: agency.agencyName, reference: agency.agencyId } : null,
      };
    }

    const mortgagee = mortgageeOf(input.details);

    return mortgagee
      ? {
          ...base,
          available: true,
          reason: null,
          payer: { name: mortgagee.name, reference: mortgagee.reference ?? null },
        }
      : {
          ...base,
          available: false,
          reason: "Add the mortgagee on the details step first",
          payer: null,
        };
  });
}
