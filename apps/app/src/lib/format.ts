const dateFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function formatDate(value: string | Date): string {
  return dateFormat.format(typeof value === "string" ? new Date(value) : value);
}

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

const plainDateFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export function formatPlainDate(value: string): string {
  return plainDateFormat.format(new Date(`${value}T00:00:00Z`));
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

const list = new Intl.ListFormat(undefined, { type: "conjunction" });

export function formatList(items: string[]): string {
  return list.format(items);
}

export interface MoneyValue {
  amount: string;
  currency: string;
}

const moneyFormats = new Map<string, Intl.NumberFormat>();

/** Whole amounts without cents ("$1,330"), anything else to the cent ("$49.07"). */
export function formatMoney(value: MoneyValue, options: { cents?: boolean } = {}): string {
  const amount = Number(value.amount);
  const cents = options.cents ?? !Number.isInteger(amount);
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

  return format.format(amount);
}

export function formatSignedMoney(value: MoneyValue): string {
  const amount = Number(value.amount);
  const magnitude = formatMoney({ ...value, amount: Math.abs(amount).toFixed(2) }, { cents: true });

  return `${amount < 0 ? "−" : "+"}${magnitude}`;
}

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function formatDateTime(value: string): string {
  return dateTimeFormat.format(new Date(value));
}

export function formatPlainDateRange(start: string, end: string): string {
  const a = new Date(`${start}T00:00:00Z`);
  const b = new Date(`${end}T00:00:00Z`);

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).formatRange(a, b);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;

  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
