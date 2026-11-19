import { globSync, readFileSync } from "node:fs";

const KERNEL = "packages/kernel/src";
const DB = "packages/db/src/mapping.ts";
const UI = "packages/ui/src/lib";

const HOMES: Record<string, readonly string[]> = {
  isRecord: [`${KERNEL}/guards.ts`],
  toPlainJson: [`${KERNEL}/guards.ts`],
  canonicalJson: [`${KERNEL}/canonical-json.ts`],
  sha256: [`${KERNEL}/hash.ts`],
  jurisdictionCode: [`${KERNEL}/jurisdiction.ts`],
  parsePlainDate: [`${KERNEL}/dates.ts`],
  parseInstant: [`${KERNEL}/dates.ts`],
  parseCsv: [`${KERNEL}/csv.ts`],
  toCsv: [`${KERNEL}/csv.ts`],
  csvCell: [`${KERNEL}/csv.ts`],
  fillMessage: [`${KERNEL}/messages.ts`],
  plainMessage: [`${KERNEL}/messages.ts`],
  // Server text uses the kernel's fixed locale; the SPAs format in the browser's locale.
  formatMoney: [`${KERNEL}/format.ts`, `${UI}/format.ts`],
  formatPlainDate: [`${KERNEL}/format.ts`, `${UI}/format.ts`],
  instantFromDb: [DB],
  instantToDb: [DB],
  plainDateFromDb: [DB],
  plainDateToDb: [DB],
  moneyFromDb: [DB],
  jsonToDb: [DB],
  formatDate: [`${UI}/format.ts`],
  formatDateTime: [`${UI}/format.ts`],
  formatRelative: [`${UI}/format.ts`],
  initials: [`${UI}/format.ts`],
  slugify: [`${UI}/format.ts`],
  plural: [`${UI}/format.ts`],
  jurisdictionName: [`${UI}/jurisdictions.ts`],
};

const ALIASES: Record<string, string> = {
  toInstant: "instantFromDb",
  toDate: "instantToDb",
  dateToDb: "plainDateToDb",
  dateFromDb: "plainDateFromDb",
};

// The workflow engine talks to Postgres through `pg` and must not depend on Prisma's @pas/db.
const EXEMPT = new Set(["packages/workflows/src/postgres.ts"]);

const names = [...Object.keys(HOMES), ...Object.keys(ALIASES)].join("|");

const definition = new RegExp(
  String.raw`^\s*(?:export\s+)?(?:(?:async\s+)?function\*?\s+(${names})\b|(?:const|let|var)\s+(${names})\s*(?::[^=]+)?=\s*(?:async\s*)?(?:function\b|(?:<[^>]*>\s*)?\(|\w+\s*=>))`,
);

const files = globSync("{apps,packages}/**/*.{ts,tsx}", {
  exclude: (path) => /(^|\/)(node_modules|dist|generated)$/.test(path),
});

const violations: string[] = [];

for (const file of files) {
  if (EXEMPT.has(file)) continue;

  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, index) => {
      const match = definition.exec(line);
      const name = match?.[1] ?? match?.[2];

      if (!name) return;

      const shared = ALIASES[name] ?? name;
      const homes = HOMES[shared]!;

      if (!homes.includes(file)) {
        violations.push(
          `${file}:${index + 1}  ${name}: import ${shared} from ${homes.join(" or ")}`,
        );
      }
    });
}

if (violations.length) {
  console.error(
    `Duplicate helpers (see CLAUDE.md "No duplicate helpers"):\n${violations.join("\n")}`,
  );

  process.exit(1);
}
