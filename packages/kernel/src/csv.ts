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

export const csvCell = (value: string) =>
  /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

export function toCsv(rows: readonly (readonly string[])[]): string {
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}
