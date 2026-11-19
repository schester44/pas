import type { PlainDate } from "./dates";
import type { Money } from "./money";

export const DEFAULT_LOCALE = "en-US";

/** `cents: "auto"` drops the cents from whole amounts ("$1,330" but "$49.10"). */
export function formatMoney(
  money: Money | { amount: string; currency: string },
  options: { locale?: string; cents?: boolean | "auto" } = {},
): string {
  const { amount, currency } = "toJSON" in money ? money.toJSON() : money;
  const value = Number(amount);

  if (!Number.isFinite(value)) return amount;

  const whole = options.cents === false || (options.cents === "auto" && Number.isInteger(value));

  return new Intl.NumberFormat(options.locale ?? DEFAULT_LOCALE, {
    style: "currency",
    currency,
    ...(whole && { maximumFractionDigits: 0 }),
  }).format(value);
}

export function formatPlainDate(date: PlainDate | string, locale = DEFAULT_LOCALE): string {
  const value = typeof date === "string" ? Temporal.PlainDate.from(date) : date;

  return value.toLocaleString(locale, { month: "short", day: "numeric", year: "numeric" });
}
