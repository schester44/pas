import type { PlainDate } from "@pas/kernel";
import type { MortgageeFollowUp } from "./model";

export type MortgageeStepAction = "remind_lender" | "offer_direct" | "nonpayment";

export interface MortgageeStep {
  id: string;
  action: MortgageeStepAction;
  on: PlainDate;
}

/** The dated follow-ups for a lender's invoice sent on `sentOn`, in order (PLAN §13). */
export function mortgageeFollowUps(config: MortgageeFollowUp, sentOn: PlainDate): MortgageeStep[] {
  const steps: (MortgageeStep & { order: number })[] = [
    ...[...new Set(config.reminderDays)]
      .filter((days) => days > 0 && days < config.nonpaymentAfterDays)
      .map((days) => ({
        id: `remind-${days}`,
        action: "remind_lender" as const,
        on: sentOn.add({ days }),
        order: 0,
      })),
    {
      id: "offer-direct",
      action: "offer_direct",
      on: sentOn.add({ days: config.offerDirectAfterDays }),
      order: 1,
    },
    {
      id: "nonpayment",
      action: "nonpayment",
      on: sentOn.add({ days: config.nonpaymentAfterDays }),
      order: 2,
    },
  ];

  return steps
    .toSorted((a, b) => Temporal.PlainDate.compare(a.on, b.on) || a.order - b.order)
    .map((step) => ({ id: step.id, action: step.action, on: step.on }));
}
