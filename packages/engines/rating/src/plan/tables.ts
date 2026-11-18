import { Decimal } from "decimal.js";
import { toDecimal } from "../context";
import type { Band, RateTable, RowKey } from "./schema";

export interface TableMatch {
  value: Decimal;
  matched: string;
}

export type TableLookup = (keys: unknown[]) => TableMatch | undefined;

interface Row {
  keys: RowKey[];
  value: Decimal;
}

const exactKey = (value: unknown) => String(value);

const isBand = (key: RowKey): key is Band => typeof key === "object";

function inBand(band: Band, value: Decimal): boolean {
  return (
    (band.from === undefined || value.gte(band.from)) &&
    (band.to === undefined || value.lt(band.to))
  );
}

function describe(keys: RowKey[]): string {
  return keys
    .map((key) => (isBand(key) ? `[${key.from ?? ""}, ${key.to ?? ""})` : String(key)))
    .join(" × ");
}

function interpolate(
  points: { x: Decimal; row: Row }[],
  x: Decimal,
): { value: Decimal; matched: string } | undefined {
  const sorted = points.toSorted((a, b) => a.x.comparedTo(b.x));

  for (let i = 0; i < sorted.length; i++) {
    const upper = sorted[i]!;

    if (upper.x.eq(x)) return { value: upper.row.value, matched: describe(upper.row.keys) };

    if (upper.x.gt(x)) {
      const lower = sorted[i - 1];

      if (!lower) return undefined;

      const share = x.minus(lower.x).dividedBy(upper.x.minus(lower.x));
      const value = lower.row.value.plus(upper.row.value.minus(lower.row.value).times(share));

      return { value, matched: `${describe(lower.row.keys)} ↔ ${describe(upper.row.keys)}` };
    }
  }

  return undefined;
}

export function compileTable(table: RateTable): TableLookup {
  const rows: Row[] = table.rows.map((row) => ({
    keys: row.keys,
    value: new Decimal(row.value),
  }));

  const fallback =
    table.default === undefined
      ? undefined
      : { value: new Decimal(table.default), matched: "default" };

  const allExact = table.dimensions.every((dimension) => dimension.match === "exact");

  if (allExact) {
    const index = new Map<string, Row>();

    for (const row of rows) index.set(row.keys.map(exactKey).join("\u0000"), row);

    return (keys) => {
      const row = index.get(keys.map(exactKey).join("\u0000"));

      return row ? { value: row.value, matched: describe(row.keys) } : fallback;
    };
  }

  const interpolated = table.dimensions.findIndex((dimension) => dimension.match === "interpolate");

  return (keys) => {
    const numeric = table.dimensions.map((dimension, i) =>
      dimension.match === "exact" ? undefined : toDecimal(keys[i], dimension.name),
    );

    const candidates = rows.filter((row) =>
      table.dimensions.every((dimension, i) => {
        const key = row.keys[i]!;

        if (dimension.match === "exact") return exactKey(key) === exactKey(keys[i]);

        if (dimension.match === "band") return isBand(key) && inBand(key, numeric[i]!);

        return true;
      }),
    );

    if (interpolated < 0) {
      const row = candidates[0];

      return row ? { value: row.value, matched: describe(row.keys) } : fallback;
    }

    const points = candidates.map((row) => ({
      x: toDecimal(row.keys[interpolated], table.dimensions[interpolated]!.name),
      row,
    }));

    return interpolate(points, numeric[interpolated]!) ?? fallback;
  };
}
