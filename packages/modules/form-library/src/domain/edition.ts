import { invalid } from "@pas/kernel";

export interface Edition {
  year: number;
  month: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Two-digit edition years are 1970–2069, matching how bureau editions are cited. */
const fullYear = (yy: number) => (yy >= 70 ? 1900 + yy : 2000 + yy);

export function parseEdition(input: string): Edition {
  const text = input.trim();
  const iso = /^(\d{4})-(\d{2})$/.exec(text);
  const cited = /^(\d{2})[\s/-]?(\d{2}|\d{4})$/.exec(text);

  const [year, month] = iso
    ? [Number(iso[1]), Number(iso[2])]
    : cited
      ? [cited[2]!.length === 4 ? Number(cited[2]) : fullYear(Number(cited[2])), Number(cited[1])]
      : [NaN, NaN];

  if (!Number.isInteger(year) || month < 1 || month > 12) {
    throw invalid("Enter the edition as month and year, like 05 11", { field: "edition" });
  }

  return { year, month };
}

export const editionKey = (edition: Edition) => `${edition.year}-${pad(edition.month)}`;

export const editionLabel = (edition: Edition) =>
  `${pad(edition.month)} ${pad(edition.year % 100)}`;

export const editionFromKey = (key: string): Edition => ({
  year: Number(key.slice(0, 4)),
  month: Number(key.slice(5, 7)),
});
