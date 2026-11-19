import type { Instant, PlainDate } from "@pas/kernel";
import type { DownloadSettings } from "./settings";

type Schedule = Pick<DownloadSettings, "batchTime" | "timeZone">;

const timeOf = (batchTime: string) => {
  const [hour = 2, minute = 0] = batchTime.split(":").map(Number);

  return { hour, minute };
};

/** When the nightly batch for `runDate` goes out, in the tenant's chosen time zone. */
export function runInstant(runDate: PlainDate, schedule: Schedule): Instant {
  return runDate
    .toPlainDateTime(timeOf(schedule.batchTime))
    .toZonedDateTime(schedule.timeZone)
    .toInstant();
}

/** The next batch that hasn't gone out yet: today's if its time is still ahead, else tomorrow's. */
export function nextRunDate(now: Instant, schedule: Schedule): PlainDate {
  const today = now.toZonedDateTimeISO(schedule.timeZone).toPlainDate();

  return Temporal.Instant.compare(now, runInstant(today, schedule)) < 0
    ? today
    : today.add({ days: 1 });
}

/**
 * Commission statements go out with the first batch of a month, for the month before. A batch
 * that catches up on skipped nights (sandbox time travel) sends every month it passed.
 */
export function statementPeriods(
  from: PlainDate,
  runDate: PlainDate,
): { from: PlainDate; to: PlainDate }[] {
  const periods: { from: PlainDate; to: PlainDate }[] = [];
  let first = from.day === 1 ? from : from.with({ day: 1 }).add({ months: 1 });

  while (Temporal.PlainDate.compare(first, runDate) <= 0) {
    periods.push({ from: first.subtract({ months: 1 }), to: first.subtract({ days: 1 }) });
    first = first.add({ months: 1 });
  }

  return periods;
}

/**
 * The night after `after`; when tenant time has moved several nights on (sandbox time travel),
 * the latest night already due instead, so one batch catches up.
 */
export function nextRunAfter(after: PlainDate, now: Instant, schedule: Schedule): PlainDate {
  const following = after.add({ days: 1 });
  const latestDue = nextRunDate(now, schedule).subtract({ days: 1 });

  return Temporal.PlainDate.compare(latestDue, following) > 0 ? latestDue : following;
}

const firstOnOrAfter = (date: PlainDate) =>
  date.day === 1 ? date : date.with({ day: 1 }).add({ months: 1 });

/**
 * The next batch worth waking for: the next night while items wait, else the first of the month
 * for commission statements, else none until an item is queued. Keeps idle tenants (and sandbox
 * time travel) free of a timer per night.
 */
export function nextBatchDate(input: {
  after: PlainDate | null;
  now: Instant;
  schedule: Schedule;
  pending: boolean;
  statements: boolean;
}): PlainDate | null {
  const base = input.after
    ? nextRunAfter(input.after, input.now, input.schedule)
    : nextRunDate(input.now, input.schedule);

  if (input.pending) return base;

  return input.statements ? firstOnOrAfter(base) : null;
}
