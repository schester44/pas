import * as formulajs from "@formulajs/formulajs";
import { Decimal } from "decimal.js";
import FormulaParser, { type FunctionArg } from "fast-formula-parser";

const { FormulaError } = FormulaParser;

type ExcelFunction = (...args: FunctionArg[]) => unknown;

export const BLOCKED_FUNCTIONS: Record<string, string> = {
  INDIRECT: "builds references at run time, so dependencies can't be known up front",
  OFFSET: "builds references at run time, so dependencies can't be known up front",
  RAND: "isn't deterministic",
  RANDBETWEEN: "isn't deterministic",
  RANDARRAY: "isn't deterministic",
  NOW: "depends on the clock; bind the term dates instead",
  TODAY: "depends on the clock; bind the term dates instead",
  WEBSERVICE: "calls the network",
  FILTERXML: "calls the network",
  INFO: "depends on the machine",
  CELL: "depends on the machine",
};

// The parser hands these a context argument first even when we supply the implementation.
const CONTEXT_FIRST = new Set(["CHOOSE"]);

function toFormulaError(error: Error): InstanceType<typeof FormulaError> {
  if (error instanceof FormulaError) return error;

  return /^#[A-Z/0!?]+/.test(error.message) ? new FormulaError(error.message) : FormulaError.VALUE;
}

function adapt(name: string, fn: (...args: unknown[]) => unknown): ExcelFunction {
  const call = (args: FunctionArg[]) => {
    try {
      const result = fn(...args.map((arg) => (arg?.omitted ? undefined : arg?.value)));

      return result instanceof Error ? toFormulaError(result) : result;
    } catch (error) {
      return toFormulaError(error as Error);
    }
  };

  return CONTEXT_FIRST.has(name) ? (_context, ...args) => call(args) : (...args) => call(args);
}

function formulajsFunctions(): Map<string, (...args: unknown[]) => unknown> {
  const found = new Map<string, (...args: unknown[]) => unknown>();

  for (const [key, value] of Object.entries(formulajs)) {
    if (typeof value === "function" && /^[A-Z]/.test(key)) {
      found.set(key, value as (...args: unknown[]) => unknown);
    } else if (value && typeof value === "object") {
      for (const [sub, fn] of Object.entries(value)) {
        if (typeof fn === "function")
          found.set(`${key}.${sub}`, fn as (...args: unknown[]) => unknown);
      }
    }
  }

  return found;
}

const flat = (value: unknown): unknown[] => (Array.isArray(value) ? value.flat() : [value]);

const scalar = (value: unknown) => (Array.isArray(value) ? value[0]?.[0] : value);

function compare(a: unknown, b: unknown): number | undefined {
  if (typeof a === "number" && typeof b === "number") return a - b;

  if (typeof a === "string" && typeof b === "string") {
    const x = a.toLowerCase();
    const y = b.toLowerCase();

    return x === y ? 0 : x < y ? -1 : 1;
  }

  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);

  return undefined;
}

function findIndex(needle: unknown, haystack: unknown[], matchMode: number, searchMode: number) {
  if (matchMode === 2) throw FormulaError.VALUE;

  const indices = haystack.map((_, i) => i);

  if (searchMode < 0) indices.reverse();

  let best = -1;

  for (const i of indices) {
    const difference = compare(haystack[i], needle);

    if (difference === undefined) continue;

    if (difference === 0) return i;

    const better = (candidate: number) => {
      const current = compare(haystack[candidate], haystack[i])!;

      return matchMode < 0 ? current < 0 : current > 0;
    };

    if (matchMode < 0 && difference < 0 && (best < 0 || better(best))) best = i;

    if (matchMode > 0 && difference > 0 && (best < 0 || better(best))) best = i;
  }

  return best;
}

const number = (arg: FunctionArg | undefined, fallback: number) =>
  arg === undefined || arg.omitted ? fallback : Number(scalar(arg.value));

const XLOOKUP: ExcelFunction = (
  lookup,
  lookupArray,
  returnArray,
  ifNotFound,
  matchMode,
  searchMode,
) => {
  const keys = lookupArray!.value as unknown[][];
  const vertical = keys.length > 1 || keys[0]?.length === 1;

  const index = findIndex(
    scalar(lookup!.value),
    flat(keys),
    number(matchMode, 0),
    number(searchMode, 1),
  );

  if (index < 0) return ifNotFound && !ifNotFound.omitted ? ifNotFound.value : FormulaError.NA;

  const values = (
    Array.isArray(returnArray!.value) ? returnArray!.value : [[returnArray!.value]]
  ) as unknown[][];

  const picked = vertical ? [values[index] ?? []] : values.map((row) => [row[index]]);

  return picked.length === 1 && picked[0]!.length === 1 ? picked[0]![0] : picked;
};

const XMATCH: ExcelFunction = (lookup, lookupArray, matchMode, searchMode) => {
  const index = findIndex(
    scalar(lookup!.value),
    flat(lookupArray!.value),
    number(matchMode, 0),
    number(searchMode, 1),
  );

  return index < 0 ? FormulaError.NA : index + 1;
};

function numeric(arg: FunctionArg | undefined): number {
  const value = scalar(arg?.value);

  if (value instanceof FormulaError) throw value;

  if (value === null || value === undefined || value === "") return 0;

  const n = Number(value);

  if (Number.isNaN(n)) throw FormulaError.VALUE;

  return n;
}

// Excel rounds the 15-digit decimal it displays, not the binary double: ROUND(1474.875, 2) is 1474.88.
function excelRound(mode: Decimal.Rounding): ExcelFunction {
  return (value, digits) => {
    const places = Math.trunc(numeric(digits));
    const x = new Decimal(numeric(value).toPrecision(15));

    if (places >= 0) return x.toDecimalPlaces(places, mode).toNumber();

    const scale = new Decimal(10).pow(-places);

    return x.dividedBy(scale).toDecimalPlaces(0, mode).times(scale).toNumber();
  };
}

const ROUNDING: Record<string, ExcelFunction> = {
  ROUND: excelRound(Decimal.ROUND_HALF_UP),
  ROUNDUP: excelRound(Decimal.ROUND_UP),
  ROUNDDOWN: excelRound(Decimal.ROUND_DOWN),
};

const stock = new FormulaParser();
const builtIn = new Set(stock.supportedFunctions());
const stockIndex = stock.functions.INDEX as (...args: unknown[]) => unknown;

type Reference = { ref?: { sheet?: string; row?: number } };

// The stock INDEX returns the picked cell without its sheet, so cross-sheet lookups read the wrong sheet.
const INDEX = ((context: unknown, range: Reference, ...rest: unknown[]) => {
  const result = stockIndex(context, range, ...rest) as Reference;
  const sheet = range?.ref?.sheet;

  if (sheet && result?.ref && result.ref.sheet == null) result.ref.sheet = sheet;

  return result;
}) as unknown as ExcelFunction;

function buildFunctions(): Record<string, ExcelFunction> {
  const functions: Record<string, ExcelFunction> = { INDEX, XLOOKUP, XMATCH, ...ROUNDING };

  for (const [name, fn] of formulajsFunctions()) {
    if (!builtIn.has(name) && !(name in BLOCKED_FUNCTIONS)) functions[name] = adapt(name, fn);
  }

  return functions;
}

export const customFunctions = buildFunctions();

export const SUPPORTED_FUNCTIONS: ReadonlySet<string> = new Set(
  [...builtIn, ...Object.keys(customFunctions)]
    .filter((name) => !(name in BLOCKED_FUNCTIONS))
    .toSorted(),
);

export function normalizeFunctionName(name: string): string {
  return name.replace(/^(_xlfn\.|_xlws\.)+/i, "").toUpperCase();
}

export function functionSupport(name: string): { supported: boolean; reason?: string } {
  const normalized = normalizeFunctionName(name);
  const blocked = BLOCKED_FUNCTIONS[normalized];

  if (blocked) return { supported: false, reason: blocked };

  if (SUPPORTED_FUNCTIONS.has(normalized)) return { supported: true };

  return { supported: false, reason: "isn't implemented by the rating engine" };
}
