import { Decimal } from "decimal.js";
import type { Rater, RatingInput, RatingResult } from "./contract";

export interface Tolerance {
  absolute?: string;
  relative?: string;
}

export interface GoldenCase {
  name: string;
  input: RatingInput;
  expected: {
    coverages?: { coverage: string; exposure?: string; premium: string }[];
    factors?: { name: string; coverage?: string; exposure?: string; value: string }[];
    total?: string;
  };
  tolerance?: Tolerance;
}

export interface GoldenDiff {
  field: string;
  expected: string;
  actual: string | null;
  difference: string | null;
}

export interface GoldenCaseResult {
  name: string;
  passed: boolean;
  diffs: GoldenDiff[];
  error?: string;
}

export interface GoldenReport {
  passed: boolean;
  total: number;
  failed: number;
  cases: GoldenCaseResult[];
}

function within(expected: Decimal, actual: Decimal, tolerance: Tolerance = {}): boolean {
  const difference = actual.minus(expected).abs();
  const absolute = new Decimal(tolerance.absolute ?? 0);
  const relative = new Decimal(tolerance.relative ?? 0).times(expected.abs());

  return difference.lte(Decimal.max(absolute, relative));
}

const where = (coverage: string | undefined, exposure: string | undefined) =>
  [coverage, exposure].filter(Boolean).join("@");

function compare(golden: GoldenCase, result: RatingResult): GoldenDiff[] {
  const diffs: GoldenDiff[] = [];

  const check = (field: string, expected: string, actual: Decimal | undefined) => {
    const want = new Decimal(expected);

    if (actual === undefined) diffs.push({ field, expected, actual: null, difference: null });
    else if (!within(want, actual, golden.tolerance)) {
      diffs.push({
        field,
        expected,
        actual: actual.toFixed(),
        difference: actual.minus(want).toFixed(),
      });
    }
  };

  for (const expected of golden.expected.coverages ?? []) {
    const actual = result.coverages.find(
      (c) => c.coverage === expected.coverage && c.exposure === expected.exposure,
    );

    check(
      `premium ${where(expected.coverage, expected.exposure)}`,
      expected.premium,
      actual?.premium.amount,
    );
  }

  for (const expected of golden.expected.factors ?? []) {
    const actual = result.factors.find(
      (f) =>
        f.name === expected.name &&
        f.coverage === expected.coverage &&
        f.exposure === expected.exposure,
    );

    check(
      `factor ${expected.name}${expected.coverage ? ` ${where(expected.coverage, expected.exposure)}` : ""}`,
      expected.value,
      actual ? new Decimal(actual.value) : undefined,
    );
  }

  if (golden.expected.total !== undefined)
    check("total", golden.expected.total, result.total.amount);

  return diffs;
}

export async function runGoldenCases(rater: Rater, cases: GoldenCase[]): Promise<GoldenReport> {
  const results: GoldenCaseResult[] = [];

  for (const golden of cases) {
    try {
      const diffs = compare(golden, await rater.rate(golden.input));
      results.push({ name: golden.name, passed: diffs.length === 0, diffs });
    } catch (error) {
      results.push({
        name: golden.name,
        passed: false,
        diffs: [],
        error: (error as Error).message,
      });
    }
  }

  const failed = results.filter((r) => !r.passed).length;

  return { passed: failed === 0, total: results.length, failed, cases: results };
}
