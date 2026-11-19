import { formatMoney, type MoneyValue } from "@pas/ui/lib/format";

export {
  formatDate,
  formatDateTime,
  formatMoney,
  formatPlainDate,
  formatRelative,
  initials,
  type MoneyValue,
  plural,
  slugify,
} from "@pas/ui/lib/format";

const list = new Intl.ListFormat(undefined, { type: "conjunction" });

export function formatList(items: string[]): string {
  return list.format(items);
}

export function formatSignedMoney(value: MoneyValue): string {
  const amount = Number(value.amount);
  const magnitude = formatMoney({ ...value, amount: Math.abs(amount).toFixed(2) }, { cents: true });

  return `${amount < 0 ? "−" : "+"}${magnitude}`;
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
