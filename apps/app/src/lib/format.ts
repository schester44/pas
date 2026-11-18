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
