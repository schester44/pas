import type { PlainDate } from "./dates";
import type { Money } from "./money";

export const DEFAULT_LOCALE = "en-US";

export function formatMoney(
  money: Money | { amount: string; currency: string },
  options: { locale?: string; cents?: boolean } = {},
): string {
  const { amount, currency } = "toJSON" in money ? money.toJSON() : money;
  const fraction = options.cents === false ? { maximumFractionDigits: 0 } : {};

  return new Intl.NumberFormat(options.locale ?? DEFAULT_LOCALE, {
    style: "currency",
    currency,
    ...fraction,
  }).format(Number(amount));
}

export function formatPlainDate(date: PlainDate | string, locale = DEFAULT_LOCALE): string {
  const value = typeof date === "string" ? Temporal.PlainDate.from(date) : date;

  return value.toLocaleString(locale, { month: "short", day: "numeric", year: "numeric" });
}
