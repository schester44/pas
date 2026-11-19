import type { DueFrom, ReportFrequency } from "@pas/decisions-engine";
import type { Instant, PlainDate } from "@pas/kernel";

export interface DueRule {
  days: number;
  from: DueFrom | "period_end";
  businessDays: boolean;
  holidays: readonly string[];
}

export interface DueAnchors {
  effective?: PlainDate;
  issued?: PlainDate;
  periodEnd?: PlainDate;
}

const compare = Temporal.PlainDate.compare;

export const laterOf = (a: PlainDate, b: PlainDate) => (compare(a, b) >= 0 ? a : b);

export function isBusinessDay(date: PlainDate, holidays: readonly string[]): boolean {
  return date.dayOfWeek <= 5 && !holidays.includes(date.toString());
}

/** Counts business days after `start`; a zero-day rule still lands on a business day. */
export function addBusinessDays(
  start: PlainDate,
  days: number,
  holidays: readonly string[],
): PlainDate {
  let date = start;
  let remaining = days;

  while (remaining > 0) {
    date = date.add({ days: 1 });

    if (isBusinessDay(date, holidays)) remaining--;
  }

  while (!isBusinessDay(date, holidays)) date = date.add({ days: 1 });

  return date;
}

function pick(date: PlainDate | undefined, name: string): PlainDate {
  if (!date) throw new Error(`The due rule counts from the ${name} date, which isn't known`);

  return date;
}

function anchorOf(rule: DueRule, anchors: DueAnchors): PlainDate {
  switch (rule.from) {
    case "effective":
      return pick(anchors.effective, "effective");
    case "issue":
      return pick(anchors.issued, "issue");
    case "later_of_effective_issue":
      return laterOf(pick(anchors.effective, "effective"), pick(anchors.issued, "issue"));
    case "period_end":
      return pick(anchors.periodEnd, "period end");
  }
}

/** The last day an obligation can be met on (PLAN §17.1). */
export function dueDate(rule: DueRule, anchors: DueAnchors): PlainDate {
  const anchor = anchorOf(rule, anchors);

  return rule.businessDays
    ? addBusinessDays(anchor, rule.days, rule.holidays)
    : anchor.add({ days: rule.days });
}

/** An obligation is late from the first moment after its due date, in the jurisdiction's time. */
export function lateFrom(date: PlainDate, timeZone: string): Instant {
  return date.add({ days: 1 }).toZonedDateTime({ timeZone }).toInstant();
}

export interface ReportingPeriod {
  start: PlainDate;
  end: PlainDate;
}

const MONTHS: Record<ReportFrequency, number> = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
};

/** The calendar period containing `date`; `end` is its last day. */
export function reportingPeriod(date: PlainDate, frequency: ReportFrequency): ReportingPeriod {
  const months = MONTHS[frequency];
  const firstMonth = Math.floor((date.month - 1) / months) * months + 1;
  const start = Temporal.PlainDate.from({ year: date.year, month: firstMonth, day: 1 });

  return { start, end: start.add({ months }).subtract({ days: 1 }) };
}
