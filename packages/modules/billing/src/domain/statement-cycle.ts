import type { PlainDate } from "@pas/kernel";

const cutoffIn = (month: Temporal.PlainYearMonth, statementDay: number | null) =>
  month.toPlainDate({
    day: statementDay ? Math.min(statementDay, month.daysInMonth) : month.daysInMonth,
  });

/** The account current cut-off on or after `day`: the agency's statement day, or the month end. */
export function cutoffOnOrAfter(day: PlainDate, statementDay: number | null): PlainDate {
  const month = day.toPlainYearMonth();
  const cutoff = cutoffIn(month, statementDay);

  return Temporal.PlainDate.compare(cutoff, day) >= 0
    ? cutoff
    : cutoffIn(month.add({ months: 1 }), statementDay);
}

export type AgingAction = "past_due" | "remind" | "suspend";

/** Aging of an unpaid statement from its due date (PLAN §13): past due, reminder, suspension. */
export function agingSteps(
  dueOn: PlainDate,
  terms: { reminderDays: number | null; suspendAfterDays: number | null },
): { id: string; action: AgingAction; on: PlainDate }[] {
  return [
    { id: "past-due", action: "past_due" as const, on: dueOn.add({ days: 1 }) },
    ...(terms.reminderDays !== null
      ? [
          {
            id: "remind",
            action: "remind" as const,
            on: dueOn.add({ days: Math.max(1, terms.reminderDays) }),
          },
        ]
      : []),
    ...(terms.suspendAfterDays !== null
      ? [
          {
            id: "suspend",
            action: "suspend" as const,
            on: dueOn.add({ days: Math.max(1, terms.suspendAfterDays) }),
          },
        ]
      : []),
  ].toSorted((a, b) => Temporal.PlainDate.compare(a.on, b.on));
}
