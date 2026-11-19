import type { BillingConfig } from "./model";

export interface PayPlanIssue {
  severity: "error" | "warning";
  message: string;
  plan?: string;
  field?: string;
}

const KEY = /^[a-z][a-z0-9_]*$/;
const DECIMAL = /^\d+(\.\d+)?$/;
const wholeDays = (value: number) => Number.isInteger(value) && value >= 0;

/** Publish checks for a version's pay plans (PLAN §13). */
export function checkPayPlans(
  config: BillingConfig,
  options: { termMonths: number },
): PayPlanIssue[] {
  const issues: PayPlanIssue[] = [];
  const seen = new Set<string>();

  const error = (message: string, plan?: string, field?: string) =>
    issues.push({ severity: "error", message, ...(plan && { plan }), ...(field && { field }) });

  for (const plan of config.payPlans) {
    const at = (field: string, message: string) => error(message, plan.key, field);

    if (!KEY.test(plan.key)) at("key", "Use lowercase letters, digits and _ for the plan key");
    else if (seen.has(plan.key)) at("key", `Another plan already uses the key ${plan.key}`);

    seen.add(plan.key);

    if (!plan.label.trim()) at("label", "Give this plan a name");

    if (!Number.isInteger(plan.installments) || plan.installments < 1) {
      at("installments", "A plan needs at least one installment");
    }

    if (!Number.isInteger(plan.intervalMonths) || plan.intervalMonths < 1) {
      at("intervalMonths", "Installments are at least a month apart");
    } else if ((plan.installments - 1) * plan.intervalMonths >= options.termMonths) {
      at(
        "installments",
        `${plan.installments} installments ${plan.intervalMonths} months apart run past the ${options.termMonths}-month term`,
      );
    }

    if (plan.downPayment.kind === "percent") {
      const percent = Number(plan.downPayment.percent);

      if (!DECIMAL.test(plan.downPayment.percent) || percent <= 0 || percent >= 100) {
        at("downPayment", "The down payment is a percent between 0 and 100");
      } else if (plan.installments < 2) {
        at("downPayment", "A down payment needs at least two installments");
      }
    }

    if (plan.installmentFee !== null && !DECIMAL.test(plan.installmentFee)) {
      at("installmentFee", `${plan.installmentFee} isn't a valid fee`);
    }

    for (const field of ["dueDaysBefore", "billDaysBeforeDue", "graceDays"] as const) {
      if (!wholeDays(plan[field])) at(field, "Use a whole number of days");
    }

    if (plan.dueDaysBefore >= plan.intervalMonths * 28) {
      at("dueDaysBefore", "Installments would fall due before the previous one");
    }

    const rules = plan.eligibility;

    if (rules.minPremium && !DECIMAL.test(rules.minPremium)) {
      at("minPremium", `${rules.minPremium} isn't a valid premium`);
    }

    if (rules.mortgageeBilling && plan.installments > 1) {
      at("mortgageeBilling", "Mortgagee billing is pay in full only");
    }
  }

  if (config.defaultPlan && !seen.has(config.defaultPlan)) {
    error(`The default plan ${config.defaultPlan} doesn't exist`, undefined, "defaultPlan");
  }

  if (config.payPlans.length > 0 && !config.payPlans.some((p) => isOpen(p.eligibility))) {
    issues.push({
      severity: "warning",
      message: "Every plan has eligibility rules, so some quotes may have no way to pay",
    });
  }

  const { dunning } = config;

  if (
    !wholeDays(dunning.retryAfterDays) ||
    !wholeDays(dunning.retries) ||
    !wholeDays(dunning.reminderAfterDays)
  ) {
    error("Use whole numbers for autopay retries and reminders", undefined, "dunning");
  }

  if (config.methods.length === 0) {
    error("Allow at least one billing method", undefined, "methods");
  }

  if (
    config.methods.includes("mortgagee") &&
    !config.payPlans.some((p) => p.installments === 1 && p.eligibility.mortgageeBilling)
  ) {
    error(
      "Mortgagee billing needs a pay-in-full plan offered when the mortgagee pays",
      undefined,
      "methods",
    );
  }

  if (config.methods.includes("agency") && !config.payPlans.some((p) => p.installments === 1)) {
    error("Agency billing needs a pay-in-full plan", undefined, "methods");
  }

  const m = config.mortgagee;

  if (
    ![m.dueDays, m.offerDirectAfterDays, m.nonpaymentAfterDays, ...m.reminderDays].every(wholeDays)
  ) {
    error("Use whole numbers of days for mortgagee follow-ups", undefined, "mortgagee");
  } else if (m.offerDirectAfterDays >= m.nonpaymentAfterDays) {
    error("Offer direct bill before nonpayment starts on a mortgagee bill", undefined, "mortgagee");
  }

  return issues;
}

function isOpen(rules: BillingConfig["payPlans"][number]["eligibility"]): boolean {
  return (
    !rules.minPremium &&
    !rules.jurisdictions?.length &&
    !rules.channels?.length &&
    !rules.when?.trim()
  );
}
