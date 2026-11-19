export interface MoneyValue {
  amount: string;
  currency: string;
}

const dateFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function formatDate(value: string | Date): string {
  return dateFormat.format(typeof value === "string" ? new Date(value) : value);
}

const plainDateFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export function formatPlainDate(value: string): string {
  return plainDateFormat.format(new Date(`${value}T00:00:00Z`));
}

const dateTimeFormats = {
  dated: new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }),
  weekday: new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }),
};

/** "Nov 19, 2026, 3:04 PM", or "Thu, Nov 19, 3:04 PM" with `weekday` for near-term times. */
export function formatDateTime(value: string, options: { weekday?: boolean } = {}): string {
  return dateTimeFormats[options.weekday ? "weekday" : "dated"].format(new Date(value));
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export function formatRelative(value: string, now = Date.now()): string {
  const seconds = Math.round((new Date(value).getTime() - now) / 1000);
  const abs = Math.abs(seconds);

  if (abs < 60) return "just now";

  if (abs < 3600) return relative.format(Math.round(seconds / 60), "minute");

  if (abs < 86400) return relative.format(Math.round(seconds / 3600), "hour");

  if (abs < 7 * 86400) return relative.format(Math.round(seconds / 86400), "day");

  return formatDate(value);
}

const moneyFormats = new Map<string, Intl.NumberFormat>();

/** Cents when the amount is written with them ("49.10", "1330.00"), none otherwise ("$1,330"). */
export function formatMoney(value: MoneyValue, options: { cents?: boolean } = {}): string {
  const cents = options.cents ?? value.amount.includes(".");
  const key = `${value.currency}:${cents}`;

  let format = moneyFormats.get(key);

  if (!format) {
    format = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: value.currency,
      minimumFractionDigits: cents ? 2 : 0,
      maximumFractionDigits: cents ? 2 : 0,
    });

    moneyFormats.set(key, format);
  }

  return format.format(Number(value.amount));
}

export const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 63);
}
