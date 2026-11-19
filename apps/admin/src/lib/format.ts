import { formatPlainDate } from "@pas/ui/lib/format";

export {
  formatDate,
  formatDateTime,
  formatMoney,
  formatPlainDate,
  formatRelative,
  initials,
  plural,
  slugify,
} from "@pas/ui/lib/format";

const plainDateFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const fromPlainDate = (value: string) => new Date(`${value}T00:00:00Z`);

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
