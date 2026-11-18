import { RatingError } from "../contract";
import type { Band, RateDimension, RateTable, RowKey } from "./schema";

// Rows pasted from a spreadsheet arrive tab-separated.
const delimiterOf = (text: string) => {
  const first = text.split(/\r?\n/, 1)[0] ?? "";

  return first.includes("\t") && !first.includes(",") ? "\t" : ",";
};

export function parseCsv(text: string): string[][] {
  const delimiter = delimiterOf(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;

    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = false;
      else cell += char;

      continue;
    }

    if (char === '"') quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;

      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }

  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const NUMBER = /^-?\d+(\.\d+)?$/;

function parseBand(cell: string): Band | undefined {
  const match = /^\s*(-?\d+(?:\.\d+)?)?\s*\.\.\s*(-?\d+(?:\.\d+)?)?\s*$/.exec(cell);

  if (!match) return undefined;

  const band: Band = {};

  if (match[1] !== undefined) band.from = Number(match[1]);

  if (match[2] !== undefined) band.to = Number(match[2]);

  return band;
}

export interface CsvTableOptions {
  key: string;
  dimensions: RateDimension[];
  valueColumn?: string;
}

/**
 * Header row names the columns. Band cells are `from..to` (half-open, either end optional);
 * a row of `*` in every dimension column is the table's default.
 */
export function rateTableFromCsv(csv: string, options: CsvTableOptions): RateTable {
  const [header, ...body] = parseCsv(csv);

  if (!header) throw new RatingError("The CSV is empty");

  const columns = header.map((name) => name.trim());

  const indexOf = (name: string) => {
    const index = columns.indexOf(name);

    if (index < 0) throw new RatingError(`The CSV has no ${name} column`, { column: name });

    return index;
  };

  const dimensionColumns = options.dimensions.map((dimension) => indexOf(dimension.name));
  const valueColumn = indexOf(options.valueColumn ?? "value");
  const table: RateTable = { key: options.key, dimensions: options.dimensions, rows: [] };

  body.forEach((cells, index) => {
    const line = index + 2;

    if (cells.length !== columns.length) {
      throw new RatingError(
        `Line ${line} has ${cells.length} ${cells.length === 1 ? "value" : "values"}; the header has ${columns.length} (${columns.join(", ")})`,
        { line },
      );
    }

    const value = cells[valueColumn]?.trim() ?? "";

    if (!NUMBER.test(value))
      throw new RatingError(`Line ${line}: ${value || "empty"} isn't a rate`, { line });

    const raw = dimensionColumns.map((column) => cells[column]?.trim() ?? "");

    if (raw.every((cell) => cell === "*")) {
      table.default = value;

      return;
    }

    const keys: RowKey[] = options.dimensions.map((dimension, i) => {
      const cell = raw[i]!;

      if (dimension.match === "exact") return cell;

      if (dimension.match === "band") {
        const band = parseBand(cell);

        if (!band) throw new RatingError(`Line ${line}: ${cell} isn't a band like 0..5`, { line });

        return band;
      }

      if (!NUMBER.test(cell))
        throw new RatingError(`Line ${line}: ${cell} isn't a number`, { line });

      return Number(cell);
    });

    table.rows.push({ keys, value });
  });

  return table;
}
