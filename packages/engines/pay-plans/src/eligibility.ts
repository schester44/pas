import type { Money } from "@pas/kernel";
import type { BillingConfig, PayPlan } from "./model";

export interface EligibilityContext {
  premium: Money;
  jurisdiction: string;
  channel: string;
  mortgageeBilled: boolean;
}

export type WhenEvaluator = (expression: string, context: Record<string, unknown>) => boolean;

/** Whether a plan is offered for this quote; `when` is the tenant's optional expression. */
export function isEligible(
  plan: PayPlan,
  context: EligibilityContext,
  evaluateWhen?: WhenEvaluator,
): boolean {
  const rules = plan.eligibility;

  if (rules.minPremium && context.premium.amount.lessThan(rules.minPremium)) return false;

  if (rules.jurisdictions?.length && !rules.jurisdictions.includes(context.jurisdiction)) {
    return false;
  }

  if (rules.channels?.length && !rules.channels.includes(context.channel)) return false;

  if (context.mortgageeBilled && !rules.mortgageeBilling) return false;

  if (rules.when?.trim() && evaluateWhen) {
    return evaluateWhen(rules.when, {
      premium: Number(context.premium.toString()),
      jurisdiction: context.jurisdiction,
      channel: context.channel,
      mortgageeBilled: context.mortgageeBilled,
    });
  }

  return true;
}

export function eligiblePlans(
  config: BillingConfig,
  context: EligibilityContext,
  evaluateWhen?: WhenEvaluator,
): PayPlan[] {
  return config.payPlans.filter((plan) => isEligible(plan, context, evaluateWhen));
}

/** The configured default when it's eligible, otherwise the first eligible plan. */
export function defaultPlanOf(config: BillingConfig, eligible: readonly PayPlan[]): PayPlan | null {
  return eligible.find((plan) => plan.key === config.defaultPlan) ?? eligible[0] ?? null;
}
