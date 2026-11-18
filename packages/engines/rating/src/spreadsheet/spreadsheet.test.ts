import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import type { RatingInput } from "../contract";
import { runGoldenCases } from "../golden";
import type { BindingManifest } from "./manifest";
import type { WorkbookModel } from "./model";
import { createSpreadsheetRater } from "./rater";
import { warmEngine } from "./warm";
import { loadWorkbook } from "./workbook";

async function homeownersWorkbook(): Promise<Uint8Array> {
  const book = new ExcelJS.Workbook();
  const inputs = book.addWorksheet("Inputs");
  const tables = book.addWorksheet("Rate Tables");
  const rating = book.addWorksheet("Rating");

  [
    "Protection class",
    "Construction",
    "Roof age",
    "Coverage A",
    "",
    "Alarm",
    "Liability limit",
  ].forEach((label, i) => (inputs.getCell(i + 1, 1).value = label));

  inputs.getCell("B1").value = 1;
  inputs.getCell("B2").value = "FR";
  inputs.getCell("B3").value = 0;
  inputs.getCell("B4").value = 100000;
  inputs.getCell("B6").value = "N";
  inputs.getCell("B7").value = 100000;

  const baseRates = [3.1, 3.25, 3.4, 3.6, 3.85, 4.1, 4.5, 5, 6.2, 7.8];
  tables.getRow(1).values = ["PC", "Rate per 1,000", "", "Construction", "Factor", "", "Minimum"];
  baseRates.forEach((rate, i) => (tables.getRow(i + 2).values = [i + 1, rate]));

  [
    ["FR", 1],
    ["MA", 0.85],
    ["SU", 0.95],
  ].forEach(([code, factor], i) => {
    tables.getCell(i + 2, 4).value = code!;
    tables.getCell(i + 2, 5).value = factor!;
  });

  tables.getCell("G2").value = 250;

  [
    [100000, 25],
    [300000, 40],
    [500000, 55],
  ].forEach(([limit, premium], i) => {
    tables.getCell(i + 2, 10).value = limit!;
    tables.getCell(i + 2, 11).value = premium!;
  });

  const formulas: [string, string][] = [
    ["B1", "VLOOKUP(ProtectionClass,'Rate Tables'!$A$2:$B$11,2,FALSE)"],
    ["B2", "INDEX('Rate Tables'!$E$2:$E$4,MATCH(Inputs!B2,'Rate Tables'!$D$2:$D$4,0))"],
    ["B3", "IF(Inputs!B3<10,1,IF(Inputs!B3<20,1.15,1.3))"],
    ["B4", 'IF(Inputs!B6="Y",0.95,1)'],
    ["B5", "Inputs!B4/1000*B1"],
    ["B6", "ROUND(B5*B2*B3*B4,2)"],
    ["B7", "MAX(B6,MinPremium)"],
    ["B8", "XLOOKUP(Inputs!B7,'Rate Tables'!J2:J4,'Rate Tables'!K2:K4)"],
  ];

  for (const [address, formula] of formulas)
    rating.getCell(address).value = { formula, date1904: false };

  book.definedNames.add("Inputs!$B$1", "ProtectionClass");
  book.definedNames.add("'Rate Tables'!$G$2", "MinPremium");
  book.definedNames.add("Rating!$B$7", "DwellingPremium");

  return new Uint8Array(await book.xlsx.writeBuffer());
}

const manifest: BindingManifest = {
  key: "ho-workbook",
  version: "1",
  currency: "USD",
  exposure: "dwellings[]",
  rounding: { mode: "half_up", places: 2 },
  inputs: [
    { path: "exposure.protectionClass", target: { name: "ProtectionClass" }, required: true },
    {
      path: "exposure.construction",
      target: { cell: "Inputs!B2" },
      transform: { kind: "map", map: { frame: "FR", masonry: "MA", superior: "SU" } },
    },
    { path: "exposure.roofAge", target: { cell: "Inputs!B3" } },
    { path: "coverages.DWELLING.limit", target: { cell: "Inputs!B4" } },
    {
      path: "exposure.alarm",
      target: { cell: "Inputs!B6" },
      transform: { kind: "boolean", true: "Y", false: "N" },
    },
    { path: "coverages.LIABILITY.limit", target: { cell: "Inputs!B7" } },
  ],
  outputs: [
    { source: { name: "DwellingPremium" }, kind: "premium", coverage: "DWELLING" },
    { source: { cell: "Rating!B8" }, kind: "premium", coverage: "LIABILITY" },
    { source: { cell: "Rating!B3" }, kind: "factor", name: "roof", coverage: "DWELLING" },
  ],
};

const input: RatingInput = {
  risk: {
    dwellings: [
      { protectionClass: 7, construction: "frame", roofAge: 12, alarm: true },
      { protectionClass: 10, construction: "masonry", roofAge: 25, alarm: false },
    ],
  },
  coverages: [
    { coverage: "DWELLING", exposure: "dwellings[0]", limit: "300000" },
    { coverage: "LIABILITY", exposure: "dwellings[0]", limit: "300000" },
    { coverage: "DWELLING", exposure: "dwellings[1]", limit: "20000" },
  ],
  term: { effective: "2027-01-01", expiration: "2028-01-01" },
  transaction: { type: "NEW_BUSINESS", effective: "2027-01-01" },
  jurisdiction: { country: "US", subdivision: "US-IL" },
  currency: "USD",
};

describe("spreadsheet engine", () => {
  let workbook: WorkbookModel;

  beforeAll(async () => {
    const loaded = await loadWorkbook(await homeownersWorkbook());

    expect(loaded.report.problems).toEqual([]);
    workbook = loaded.ok ? loaded.workbook : (undefined as never);
  });

  it("rates a homeowners workbook through the binding manifest", async () => {
    const rater = createSpreadsheetRater(workbook, manifest);
    const result = await rater.rate(input);

    // 300 × 4.50 × 1.00 × 1.15 × 0.95 = 1474.875; Excel's ROUND gives 1474.88 although the double is …874999.
    // 20 × 7.80 × 0.85 × 1.30 = 172.38, lifted to the 250 minimum.
    expect(result.coverages.map((c) => [c.coverage, c.exposure, c.premium.toString()])).toEqual([
      ["DWELLING", "dwellings[0]", "1474.88"],
      ["LIABILITY", "dwellings[0]", "40"],
      ["DWELLING", "dwellings[1]", "250"],
    ]);

    expect(result.factors.map((f) => [f.exposure, f.value])).toEqual([
      ["dwellings[0]", "1.15"],
      ["dwellings[1]", "1.3"],
    ]);

    expect(
      result.worksheet.filter((s) => s.exposure === "dwellings[0]").map((s) => s.name),
    ).toContain("Rating!B6");

    const report = await runGoldenCases(rater, [
      {
        name: "two dwellings",
        input,
        expected: {
          total: "1764.88",
          coverages: [{ coverage: "LIABILITY", exposure: "dwellings[0]", premium: "40" }],
        },
      },
      { name: "drifted", input, expected: { total: "1764.80" }, tolerance: { absolute: "0.05" } },
    ]);

    expect(report.cases.map((c) => [c.name, c.passed])).toEqual([
      ["two dwellings", true],
      ["drifted", false],
    ]);

    expect(report.cases[1]!.diffs).toEqual([
      { field: "total", expected: "1764.80", actual: "1764.88", difference: "0.08" },
    ]);
  });

  it("recalculates only cells downstream of a changed input, without touching the warm instance", () => {
    const engine = warmEngine(workbook);
    const session = engine.session();

    session.set("Inputs!B3", 25);
    expect(session.recalculate()).toEqual(["Rating!B3", "Rating!B6", "Rating!B7"]);
    expect(session.get("DwellingPremium")).toBe(403);

    session.set("ProtectionClass", 9);
    session.set("Inputs!B4", 400000);

    expect(session.recalculate().toSorted()).toEqual([
      "Rating!B1",
      "Rating!B5",
      "Rating!B6",
      "Rating!B7",
    ]);

    // 400 × 6.20 × 1.00 × 1.30 × 1.00 = 3224.
    expect(session.get("Rating!B7")).toBe(3224);

    expect(session.recalculate()).toEqual([]);
    expect(engine.session().get("Rating!B7")).toBe(310);
  });
});
