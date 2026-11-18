import type { FieldNode } from "./schema";

export type Coerced = { ok: true; value: unknown } | { ok: false; message: string };

export interface Messages {
  required: (field: FieldNode) => string;
  number: string;
  integer: string;
  money: (decimals: number) => string;
  date: string;
  email: string;
  phone: string;
  option: string;
  address: string;
  file: string;
  minItems: (count: number) => string;
  maxItems: (count: number) => string;
}

export const defaultMessages: Messages = {
  required: (field) => {
    if (field.kind === "enum" || field.kind === "multi_enum" || field.kind === "boolean") {
      return "Choose an option";
    }

    if (field.kind === "file") return "Upload a file";

    if (field.kind === "date") return "Enter a date";

    if (field.kind === "address") return "Enter an address";

    return "Enter a value";
  },
  number: "Enter a number",
  integer: "Enter a whole number",
  money: (decimals) =>
    decimals === 0 ? "Enter a whole amount" : `Enter an amount with up to ${decimals} decimals`,
  date: "Enter a date as YYYY-MM-DD",
  email: "Enter an email address like name@example.com",
  phone: "Enter a phone number with 7 to 15 digits",
  option: "Choose one of the listed options",
  address: "Enter the street, city, region and postal code",
  file: "Upload the file again",
  minItems: (count) => (count === 1 ? "Add at least one entry" : `Add at least ${count} entries`),
  maxItems: (count) => (count === 1 ? "Keep only one entry" : `Keep at most ${count} entries`),
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const blank = (value: unknown) => typeof value === "string" && value.trim() === "";

export function isEmpty(field: FieldNode, value: unknown): boolean {
  if (value === undefined || value === null || blank(value)) return true;

  if (field.kind === "multi_enum") return Array.isArray(value) && value.length === 0;

  if (field.kind === "address" && isRecord(value)) {
    return ["line1", "line2", "city", "region", "postalCode"].every(
      (key) => value[key] == null || blank(value[key]),
    );
  }

  return false;
}

export function currencyDecimals(currency = "USD"): number {
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
    .maximumFractionDigits!;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;

  if (typeof value !== "string" || !/^\s*-?(\d+\.?\d*|\.\d+)\s*$/.test(value)) return undefined;

  return Number(value);
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) return false;

  const [year, month, day] = match.slice(1).map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function coerceMoney(field: FieldNode, value: unknown, messages: Messages): Coerced {
  const decimals = currencyDecimals(field.currency);

  const text =
    typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";

  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text.replaceAll(",", ""));

  if (!match || (match[3]?.length ?? 0) > decimals)
    return { ok: false, message: messages.money(decimals) };

  const whole = match[2]!.replace(/^0+(?=\d)/, "");
  const fraction = (match[3] ?? "").padEnd(decimals, "0");

  return { ok: true, value: `${match[1]}${whole}${decimals ? `.${fraction}` : ""}` };
}

function coerceAddress(field: FieldNode, value: unknown, messages: Messages): Coerced {
  if (!isRecord(value)) return { ok: false, message: messages.address };

  const part = (key: string) => (typeof value[key] === "string" ? value[key].trim() : "");

  const address = {
    line1: part("line1"),
    ...(part("line2") && { line2: part("line2") }),
    city: part("city"),
    region: part("region"),
    postalCode: part("postalCode"),
    country: field.country ?? part("country"),
  };

  const complete =
    address.line1 && address.city && address.region && address.postalCode && address.country;

  return complete ? { ok: true, value: address } : { ok: false, message: messages.address };
}

const fail = (message: string): Coerced => ({ ok: false, message });

const optionValues = (field: FieldNode) => new Set(field.options?.map((option) => option.value));

export function coerce(
  field: FieldNode,
  value: unknown,
  messages: Messages = defaultMessages,
): Coerced {
  switch (field.kind) {
    case "text":
      return typeof value === "string"
        ? { ok: true, value: value.trim() }
        : fail(messages.required(field));
    case "number":
    case "percent": {
      const number = toNumber(value);

      return number === undefined ? fail(messages.number) : { ok: true, value: number };
    }
    case "integer": {
      const number = toNumber(value);

      return number !== undefined && Number.isInteger(number)
        ? { ok: true, value: number }
        : fail(messages.integer);
    }
    case "money":
      return coerceMoney(field, value, messages);
    case "date":
      return typeof value === "string" && isCalendarDate(value.trim())
        ? { ok: true, value: value.trim() }
        : fail(messages.date);
    case "boolean":
      return typeof value === "boolean" ? { ok: true, value } : fail(messages.option);
    case "enum":
      return typeof value === "string" && optionValues(field).has(value)
        ? { ok: true, value }
        : fail(messages.option);
    case "multi_enum": {
      const allowed = optionValues(field);

      return Array.isArray(value) &&
        value.every((item) => typeof item === "string" && allowed.has(item))
        ? { ok: true, value: [...new Set(value)] }
        : fail(messages.option);
    }
    case "address":
      return coerceAddress(field, value, messages);
    case "phone": {
      const text = typeof value === "string" ? value.trim() : "";
      const digits = text.replace(/[\s().+-]/g, "");

      return /^\d{7,15}$/.test(digits) && /^\+?[\d\s().-]+$/.test(text)
        ? { ok: true, value: text }
        : fail(messages.phone);
    }
    case "email": {
      const text = typeof value === "string" ? value.trim() : "";

      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)
        ? { ok: true, value: text }
        : fail(messages.email);
    }
    case "file":
      return isRecord(value) && typeof value.id === "string" && typeof value.name === "string"
        ? { ok: true, value }
        : fail(messages.file);
  }
}

// Expressions compare money numerically; the submitted value stays an exact decimal string.
export function toExpressionValue(field: FieldNode, value: unknown): unknown {
  return field.kind === "money" && typeof value === "string" ? Number(value) : value;
}
