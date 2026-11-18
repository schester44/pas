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

const fromPlainDate = (value: string) => new Date(`${value}T00:00:00Z`);

export function formatPlainDate(value: string): string {
  return plainDateFormat.format(fromPlainDate(value));
}

export function addDays(value: string, days: number): string {
  const date = fromPlainDate(value);
  date.setUTCDate(date.getUTCDate() + days);

  return date.toISOString().slice(0, 10);
}

/** Windows end exclusively; people read the last effective day. */
export function formatDateWindow(window: { from: string; to?: string }): string {
  if (!window.to) return `From ${formatPlainDate(window.from)}`;

  const lastDay = fromPlainDate(addDays(window.to, -1));

  return plainDateFormat.formatRange(fromPlainDate(window.from), lastDay);
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

export function formatMoney(amount: string, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: amount.includes(".") ? 2 : 0,
  }).format(Number(amount));
}
