import type { MoneyValue } from "./format";

export type { MoneyValue };

export type CoverageAmount =
  | { kind: "money"; amount: string; currency: string }
  | { kind: "percent"; value: string };

export function money(value: MoneyValue, options: { signed?: boolean; absolute?: boolean } = {}) {
  const n = Number(value.amount);
  const shown = options.absolute ? Math.abs(n) : n;

  const text = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: value.currency,
  }).format(shown);

  return options.signed && n > 0 ? `+${text}` : text;
}

export const amountLabel = (value: CoverageAmount | undefined | null) =>
  !value
    ? "–"
    : value.kind === "money"
      ? money({ amount: value.amount, currency: value.currency }).replace(/\.00$/, "")
      : `${value.value}%`;

export const sameAmount = (a?: CoverageAmount | null, b?: CoverageAmount | null) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * The server's name for an exposure ("Location 2 (12 Main St)"); keys stored by position before
 * names were sent read as "Location 2". Policy-level coverages have no exposure.
 */
export function exposureLabel(exposure?: string | null, labels?: Record<string, string>) {
  if (!exposure) return null;

  if (labels?.[exposure]) return labels[exposure];

  const match = /\[(\d+)\]$/.exec(exposure);

  return match ? `Location ${Number(match[1]) + 1}` : null;
}

const plain = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export const plainDate = (value: string) => plain.format(new Date(`${value}T00:00:00Z`));

export function daysUntil(date: string, today = new Date()) {
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());

  return Math.round((new Date(`${date}T00:00:00Z`).getTime() - start) / 86_400_000);
}

const words = (code: string) => code.replaceAll("_", " ");

/** "Illinois requires 30 days' notice for underwriting cancellations, plus 5 days for mailing." */
export function noticeExplanation(input: {
  jurisdictionName: string;
  reasonLabel: string;
  initiator: string;
  minDaysNotice: number;
  mailingDaysAdded: number;
  atInception?: boolean;
}) {
  const reason = input.reasonLabel.toLowerCase();

  if (input.minDaysNotice === 0 && input.mailingDaysAdded === 0) {
    const subject = input.initiator === "insured" ? "at the insured's request" : `for ${reason}`;

    return input.atInception
      ? `${input.jurisdictionName} requires no advance notice for cancellations ${subject}. The policy hasn't started yet, so the earliest date is inception.`
      : `${input.jurisdictionName} requires no advance notice for cancellations ${subject}, so they can take effect today.`;
  }

  const mailing =
    input.mailingDaysAdded > 0 ? `, plus ${input.mailingDaysAdded} days for mailing` : "";

  const inception = input.atInception
    ? " That period ends before the policy starts, so the earliest date is inception."
    : "";

  return `${input.jurisdictionName} requires ${input.minDaysNotice} days' notice for cancellations for ${reason}${mailing}.${inception}`;
}

/** No notice rule covers the jurisdiction, so no notice goes out and none is required. */
export function noNoticeExplanation(input: { jurisdictionName: string; atInception?: boolean }) {
  return input.atInception
    ? `No notice rule covers ${input.jurisdictionName}, so no notice goes out. The policy hasn't started yet, so the earliest date is inception.`
    : `No notice rule covers ${input.jurisdictionName}, so no notice goes out and the cancellation can take effect today.`;
}

export const deliveryLabel = (code: string) =>
  ({
    electronic: "Electronic",
    first_class_mail: "First-class mail",
    first_class_mail_with_certificate: "First-class mail with certificate of mailing",
    certified_mail: "Certified mail",
  })[code] ?? words(code);

export const recipientLabel = words;
