import type { AddressValue, FieldNode } from "@pas/forms-core";
import { formatMoney, isRecord } from "@pas/kernel";
import type { CoverageAmount, MoneyValue } from "./context";

export const DASH = "—";

export function formatAmount(value: CoverageAmount | undefined): string {
  if (!value) return DASH;

  return value.kind === "money" ? formatMoney(value, { cents: "auto" }) : `${value.value}%`;
}

export function formatLongDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  return Temporal.PlainDate.from(value).toLocaleString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function formatAddress(value: Partial<AddressValue>, multiline = false): string {
  const locality = [value.city, [value.region, value.postalCode].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");

  const lines = [[value.line1, value.line2].filter(Boolean).join(", "), locality].filter(Boolean);

  return lines.join(multiline ? "\n" : ", ");
}

const isMoney = (value: unknown): value is MoneyValue =>
  isRecord(value) && typeof value.amount === "string" && typeof value.currency === "string";

const isAddress = (value: unknown): value is Partial<AddressValue> =>
  isRecord(value) && ("line1" in value || "city" in value);

/** Formats a context value for print, using the schema node when one describes it. */
export function formatValue(value: unknown, node?: FieldNode): string {
  if (value === undefined || value === null || value === "") return "";

  if (isMoney(value)) return formatMoney(value, { cents: "auto" });

  if (isAddress(value)) return formatAddress(value);

  if (Array.isArray(value)) return value.map((entry) => formatValue(entry, node)).join(", ");

  switch (node?.kind) {
    case "money":
      return formatMoney(
        { amount: String(value), currency: node.currency ?? "USD" },
        { cents: "auto" },
      );
    case "percent":
      return `${String(value)}%`;
    case "date":
      return formatLongDate(String(value));
    case "enum":
    case "multi_enum":
      return node.options?.find((option) => option.value === value)?.label ?? String(value);
    case "number":
      return typeof value === "number" ? value.toLocaleString("en-US") : String(value);
    default:
      break;
  }

  if (typeof value === "boolean") return value ? "Yes" : "No";

  if (typeof value === "number") return String(value);

  if (typeof value === "string") return value;

  return "";
}
