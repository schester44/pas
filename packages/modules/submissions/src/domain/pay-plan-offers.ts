import { evaluate } from "@pas/expressions";
import type { Money, PlainDate } from "@pas/kernel";
import {
  type BillingConfig,
  buildSchedule,
  defaultPlanOf,
  eligiblePlans,
  type PayPlan,
} from "@pas/pay-plans";
import type { TaxFeeLine } from "./taxes-fees";

type MoneyJson = { amount: string; currency: string };

/** A pay plan offered on a quote, with its schedule for the quoted premium (PLAN §13). */
export interface PayPlanOffer {
  key: string;
  label: string;
  installments: number;
  intervalMonths: number;
  isDefault: boolean;
  dueToday: MoneyJson;
  regular: MoneyJson | null;
  total: MoneyJson;
  installmentFee: MoneyJson | null;
  schedule: { number: number; dueOn: string; amount: MoneyJson }[];
}

const whenTrue = (expression: string, context: Record<string, unknown>) => {
  try {
    return evaluate(expression, context) === true;
  } catch {
    return false;
  }
};

export function payPlanOffers(
  config: BillingConfig,
  input: {
    premium: Money;
    taxesFees: readonly TaxFeeLine[];
    jurisdiction: string;
    channel: string;
    termStart: PlainDate;
    today: PlainDate;
  },
): PayPlanOffer[] {
  const eligible = eligiblePlans(
    config,
    {
      premium: input.premium,
      jurisdiction: input.jurisdiction,
      channel: input.channel,
      mortgageeBilled: false,
    },
    whenTrue,
  );

  const fallback = defaultPlanOf(config, eligible);

  return eligible.map((plan) => offerOf(plan, plan.key === fallback?.key, input));
}

function offerOf(
  plan: PayPlan,
  isDefault: boolean,
  input: Parameters<typeof payPlanOffers>[1],
): PayPlanOffer {
  const schedule = buildSchedule(plan, {
    premium: input.premium,
    taxesFees: input.taxesFees.map((t) => ({ code: t.code, label: t.label, amount: t.amount })),
    effectiveDate: input.termStart,
    billedOn: input.today,
    rounding: { places: 2, mode: "half_up" },
  });

  const total = schedule.reduce((sum, i) => sum.plus(i.total), input.premium.minus(input.premium));

  return {
    key: plan.key,
    label: plan.label,
    installments: schedule.length,
    intervalMonths: plan.intervalMonths,
    isDefault,
    dueToday: schedule[0]!.total.toJSON(),
    regular: schedule[1]?.total.toJSON() ?? null,
    total: total.toJSON(),
    installmentFee: plan.installmentFee && schedule.length > 1 ? schedule[1]!.fee.toJSON() : null,
    schedule: schedule.map((i) => ({
      number: i.number,
      dueOn: i.dueOn.toString(),
      amount: i.total.toJSON(),
    })),
  };
}
