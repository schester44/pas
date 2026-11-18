import type { Coordinate } from "fast-formula-parser";

export function columnNumber(letters: string): number {
  let n = 0;

  for (const char of letters.toUpperCase()) n = n * 26 + (char.charCodeAt(0) - 64);

  return n;
}

export function columnLetters(col: number): string {
  let letters = "";

  for (let n = col; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }

  return letters;
}

export function parseCell(address: string): Coordinate | undefined {
  const match = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(address.trim());

  if (!match) return undefined;

  return { col: columnNumber(match[1]!), row: Number(match[2]) };
}

export const formatCell = ({ row, col }: Coordinate) => `${columnLetters(col)}${row}`;

export interface SheetRange {
  sheet: string;
  from: Coordinate;
  to: Coordinate;
}

export function parseRange(text: string, defaultSheet?: string): SheetRange | undefined {
  const bang = text.lastIndexOf("!");
  const rawSheet = bang < 0 ? defaultSheet : text.slice(0, bang);
  const sheet = rawSheet?.replace(/^'(.*)'$/, "$1").replace(/''/g, "'");
  const [start, end] = text.slice(bang + 1).split(":");
  const from = start ? parseCell(start) : undefined;
  const to = end === undefined ? from : parseCell(end);

  if (!sheet || !from || !to) return undefined;

  return {
    sheet,
    from: { row: Math.min(from.row, to.row), col: Math.min(from.col, to.col) },
    to: { row: Math.max(from.row, to.row), col: Math.max(from.col, to.col) },
  };
}

export function formatRange({ sheet, from, to }: SheetRange): string {
  const prefix = /^[A-Za-z_][A-Za-z0-9_.]*$/.test(sheet) ? sheet : `'${sheet.replace(/'/g, "''")}'`;
  const single = from.row === to.row && from.col === to.col;

  return `${prefix}!${formatCell(from)}${single ? "" : `:${formatCell(to)}`}`;
}
