import { DomainError, formatPlainDate, type PlainDate } from "@pas/kernel";

/** One `notice_rules` decision result (PLAN §17.3). */
export interface NoticeRule {
  minDaysNotice: number;
  mailingDaysAdded: number;
  allowedReasons: readonly string[];
  deliveryMethods: readonly string[];
  recipients: readonly string[];
  mustStateReason?: boolean;
}

export interface EarliestCancellation {
  date: PlainDate;
  noticeDate: PlainDate;
  minDaysNotice: number;
  mailingDaysAdded: number;
  delivery: string;
  /** The notice period ends before the term starts, so the cancellation is flat at inception. */
  atInception: boolean;
}

const compare = Temporal.PlainDate.compare;

/** Delivery recorded when no notice rule covers the jurisdiction: no notice is sent or mailed. */
export const NO_NOTICE = "none";

/** Whether the cancellation waits on proof of mailing before it takes effect. */
export const mailsNotice = (delivery: string) =>
  delivery !== "electronic" && delivery !== NO_NOTICE;

export const policyAgeDays = (inception: PlainDate, on: PlainDate) =>
  Math.max(0, inception.until(on, { largestUnit: "days" }).days);

/**
 * The earliest legally valid cancellation date: the notice date plus the required notice days,
 * plus the mailing days when the notice goes by mail, never before the term starts. Without a
 * notice rule there's no notice period, so the cancellation can take effect on the notice date.
 */
export function earliestCancellationDate(input: {
  noticeDate: PlainDate;
  termStart: PlainDate;
  termEnd: PlainDate;
  reason: string;
  rule: NoticeRule | null;
}): EarliestCancellation {
  const { noticeDate, termStart, termEnd, reason, rule } = input;

  if (rule && rule.allowedReasons.length > 0 && !rule.allowedReasons.includes(reason)) {
    throw new DomainError("precondition_failed", "This reason isn't allowed for this policy now", {
      reason: "reason_not_allowed",
      allowedReasons: [...rule.allowedReasons],
    });
  }

  const delivery = rule ? (rule.deliveryMethods[0] ?? "electronic") : NO_NOTICE;
  const minDaysNotice = rule?.minDaysNotice ?? 0;
  const mailingDaysAdded = rule && delivery !== "electronic" ? rule.mailingDaysAdded : 0;
  const noticeEnds = noticeDate.add({ days: minDaysNotice + mailingDaysAdded });
  const atInception = compare(noticeEnds, termStart) < 0;
  const date = atInception ? termStart : noticeEnds;

  if (compare(date, termEnd) >= 0) {
    throw new DomainError(
      "precondition_failed",
      "The notice period runs past the end of the term",
      {
        reason: "notice_past_expiration",
        earliest: date.toString(),
      },
    );
  }

  return {
    date,
    noticeDate,
    minDaysNotice,
    mailingDaysAdded,
    delivery,
    atInception,
  };
}

export function assertCancellationDate(requested: PlainDate, earliest: EarliestCancellation) {
  if (compare(requested, earliest.date) < 0) {
    throw new DomainError(
      "precondition_failed",
      `The earliest valid cancellation date is ${formatPlainDate(earliest.date)}`,
      { reason: "before_earliest_date", earliest: earliest.date.toString() },
    );
  }
}
