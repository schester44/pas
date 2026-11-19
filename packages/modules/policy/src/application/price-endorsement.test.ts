import type { FormDefinition, RiskSchema } from "@pas/forms-core";
import {
  asId,
  type Clock,
  jurisdiction,
  Money,
  type PlainDate,
  type TenantContext,
} from "@pas/kernel";
import { describe, expect, it } from "vitest";
import { issuedRisk } from "../domain/endorsable";
import { Policy } from "../domain/policy";
import { coverageJson } from "../domain/term-state";
import type { PolicyProductConfig, PolicyRelease } from "../ports/product-config";
import type { TermRater } from "../ports/term-rater";
import { priceEndorsement } from "./price-endorsement";

const schema: RiskSchema = {
  fields: [
    {
      key: "locations",
      kind: "repeatable",
      label: "Locations",
      exposure: "location",
      endorsable: true,
      children: [
        { key: "name", kind: "text", label: "Name" },
        { key: "roofAge", kind: "integer", label: "Roof age", endorsable: true },
        { key: "sprinklered", kind: "boolean", label: "Sprinklered", endorsable: true },
      ],
    },
  ],
};

const form: FormDefinition = {
  key: "quote",
  title: "Quote",
  steps: [
    {
      id: "risk",
      title: "Risk",
      sections: [
        {
          id: "locations",
          repeat: "locations",
          itemLabel: "Location",
          items: [
            { path: "name", required: true },
            { path: "roofAge", required: true },
          ],
        },
      ],
    },
  ],
};

const release: PolicyRelease = {
  id: "release",
  productId: "product",
  version: "1",
  jurisdiction: jurisdiction("US", "US-FL"),
  riskSchema: schema,
  forms: [{ channel: "agent", stage: "quote", form }],
  rules: [],
  documents: { templates: [], clauses: [], schedule: [] },
  lifecycle: { transactions: { endorsement: { outOfSequence: "reroll" } } },
};

const usd = (amount: string | number) => Money.of(String(amount), "USD");

type Row = { name?: string; roofAge?: number; sprinklered?: boolean };

/** Dwelling per location from its roof age, plus flat liability; the PAS prorates. */
const rater: TermRater = {
  async rate(_ctx, input) {
    const rows = (input.risk.locations ?? []) as Row[];

    const coverages = [
      ...rows.map((row, i) => ({
        coverage: "dwelling",
        exposure: `locations[${i}]`,
        name: "Dwelling",
        premium: usd(1000 + 7 * (row.roofAge ?? 0) - (row.sprinklered ? 113 : 0)),
      })),
      { coverage: "liability", name: "Liability", premium: usd(100) },
    ];

    return {
      outcome: "quoted",
      reasons: [],
      offers: [],
      coverages,
      taxesFees: [],
      writtenPremium: coverages.reduce((sum, c) => sum.plus(c.premium), usd(0)),
      rater: null,
      decisions: [],
    };
  },
  async taxesOn(_ctx, { premium }) {
    return [
      {
        code: "TAX",
        label: "Premium tax",
        remitter: "carrier",
        basis: "premium",
        amount: premium.times("0.0317").round(2, "half_up"),
      },
    ];
  },
};

const config: PolicyProductConfig = {
  release: async () => release,
  publishedReleases: async () => [release],
};

const deps = { config, rater };
const ctx: TenantContext = { tenantId: asId("tenant"), actor: { type: "system" } } as TenantContext;
const date = (iso: string) => Temporal.PlainDate.from(iso);
const start = date("2027-01-01");

const clock: Clock = {
  now: () => Temporal.Instant.from("2027-01-01T12:00:00Z"),
  today: () => start,
};

const actor = { type: "user" as const, name: "Tester" };

async function bind(locations: Row[]) {
  const risk = { locations };

  const rated = await rater.rate(ctx, {
    productReleaseId: "release",
    jurisdiction: release.jurisdiction,
    termStart: start,
    termEnd: date("2028-01-01"),
    transaction: { type: "NEW_BUSINESS", effective: start },
    risk,
    coverages: [],
  });

  return Policy.issueNewBusiness(
    {
      tenantId: ctx.tenantId,
      number: "P-1",
      productId: "product",
      productName: "Home",
      productReleaseId: "release",
      productVersion: "1",
      jurisdiction: release.jurisdiction,
      effectiveDate: start,
      expirationDate: date("2028-01-01"),
      insuredName: "Ana",
      producer: { id: "u", name: "U", agencyId: null, agencyName: null },
      sourceSubmissionId: "s",
      sourceQuoteId: "q",
      writtenPremium: rated.writtenPremium,
      taxesAndFees: usd(0),
      lines: rated.coverages.map((c) => ({
        kind: "written_premium" as const,
        code: c.coverage,
        label: c.name,
        coverage: c.coverage,
        ...(c.exposure && { exposure: c.exposure }),
        amount: c.premium,
      })),
      snapshot: { risk, coverages: rated.coverages.map(coverageJson) },
      billingMethod: "direct",
      payPlan: null,
      today: start,
      actor,
      history: [],
    },
    clock,
  );
}

type Rows = Record<string, unknown>[];

async function endorse(policy: Policy, on: string, edit: (rows: Rows) => Rows) {
  const term = policy.currentTerm;
  const risk = issuedRisk(schema, policy.latestVersion(term.id).snapshot);
  const effectiveDate: PlainDate = date(on);

  const details = await priceEndorsement(deps, ctx, policy, {
    effectiveDate,
    risk: { ...risk, locations: edit(risk.locations as Rows) },
  });

  const transaction = policy.quoteTransaction(
    { termId: term.id, type: "ENDORSEMENT", effectiveDate, details, actor },
    clock,
  );

  policy.issueTransaction(transaction.id, effectiveDate, clock);

  return policy.transaction(transaction.id);
}

const setRoof = (index: number, roofAge: number) => (rows: Rows) =>
  rows.map((row, i) => (i === index ? { ...row, roofAge } : row));

const addRow = (rows: Rows) => [...rows, { $id: "added", name: "Barn", roofAge: 3 }];

const finalState = (policy: Policy) => {
  const term = policy.currentTerm;
  const { snapshot } = policy.latestVersion(term.id);

  return {
    risk: snapshot.risk,
    coverages: snapshot.coverages,
    written: term.writtenPremium.toString(),
    taxes: term.taxesAndFees.toString(),
  };
};

describe("priceEndorsement", () => {
  it("pairs premium by row id when a middle location is removed", async () => {
    const policy = await bind([
      { name: "Home", roofAge: 4 },
      { name: "Cabin", roofAge: 20 },
      { name: "Shed", roofAge: 9 },
    ]);

    const t = await endorse(policy, "2027-07-02", (rows) => [rows[0]!, rows[2]!]);

    expect(t.details!.changes.map((c) => c.label)).toEqual(["Location 2 (Cabin) removed"]);
    expect(t.details!.premium).toHaveLength(1);
    expect(t.details!.premium[0]!.exposure).toBe("locations[#row-2]");
    expect(t.details!.premium[0]!.before.toString()).toBe("1140");
    expect(t.details!.premium[0]!.amount.toString()).toBe("-571.56");
  });

  it("issued out of order, two endorsements end where issuing them in order does", async () => {
    const rows = [
      { name: "Home", roofAge: 4 },
      { name: "Cabin", roofAge: 20 },
    ];

    const inOrder = await bind(rows);
    await endorse(inOrder, "2027-02-01", setRoof(0, 10));
    await endorse(inOrder, "2027-03-01", (r) => addRow(setRoof(1, 30)(r)));

    const outOfOrder = await bind(rows);
    const later = await endorse(outOfOrder, "2027-03-01", (r) => addRow(setRoof(1, 30)(r)));
    const earlier = await endorse(outOfOrder, "2027-02-01", setRoof(0, 10));

    expect(finalState(outOfOrder)).toEqual(finalState(inOrder));

    const segment = earlier.details!.reroll![0]!;
    const offset = segment.reversed.premium.map((l) => [l.exposure, l.amount.toString()]);
    const original = later.details!.premium.map((l) => [l.exposure, l.amount.negated().toString()]);

    expect(segment.transactionId).toBe(later.id);
    expect(offset).toEqual(original);

    expect(segment.reversed.fees[0]!.amount.toString()).toBe(
      later.details!.fees[0]!.amount.negated().toString(),
    );

    const versions = outOfOrder.timeline(outOfOrder.currentTerm.id);

    expect(versions.map((v) => [v.effectiveDate.toString(), v.transactionId])).toEqual([
      ["2027-01-01", expect.any(String)],
      ["2027-02-01", earlier.id],
      ["2027-03-01", earlier.id],
    ]);

    const financials = outOfOrder
      .toSnapshot()
      .financials.filter((f) => f.transactionId === earlier.id);

    expect(new Set(financials.map((f) => f.effectiveDate.toString()))).toEqual(
      new Set(["2027-02-01", "2027-03-01"]),
    );
  });

  it("rerolls a reroll: a third change dated before both offsets what the second re-issued", async () => {
    const rows = [
      { name: "Home", roofAge: 4 },
      { name: "Cabin", roofAge: 20 },
    ];

    const inOrder = await bind(rows);
    await endorse(inOrder, "2027-01-15", setRoof(1, 2));
    await endorse(inOrder, "2027-02-01", setRoof(0, 10));
    await endorse(inOrder, "2027-03-01", addRow);

    const outOfOrder = await bind(rows);
    await endorse(outOfOrder, "2027-03-01", addRow);
    await endorse(outOfOrder, "2027-02-01", setRoof(0, 10));
    const first = await endorse(outOfOrder, "2027-01-15", setRoof(1, 2));

    expect(first.details!.reroll!.map((s) => s.label)).toEqual([
      "Feb 1, 2027 endorsement",
      "Mar 1, 2027 endorsement",
    ]);

    expect(finalState(outOfOrder)).toEqual(finalState(inOrder));
  });

  it("lets the later change win from its date where both touch the same field", async () => {
    const rows = [{ name: "Home", roofAge: 4 }];

    const inOrder = await bind(rows);
    await endorse(inOrder, "2027-02-01", setRoof(0, 10));
    await endorse(inOrder, "2027-03-01", setRoof(0, 30));

    const outOfOrder = await bind(rows);
    await endorse(outOfOrder, "2027-03-01", setRoof(0, 30));
    const earlier = await endorse(outOfOrder, "2027-02-01", setRoof(0, 10));

    expect(finalState(outOfOrder)).toEqual(finalState(inOrder));
    expect((finalState(outOfOrder).risk as { locations: Row[] }).locations[0]!.roofAge).toBe(30);

    expect(earlier.details!.reroll![0]!.conflicts).toEqual([
      {
        path: "locations[#row-1].roofAge",
        label: "Location (Home) · Roof age",
        ours: 10,
        theirs: 30,
        outcome: "theirs_from_date",
      },
    ]);
  });

  it("rejects out-of-sequence changes when the product doesn't reroll", async () => {
    const policy = await bind([{ name: "Home", roofAge: 4 }]);
    await endorse(policy, "2027-03-01", setRoof(0, 30));

    release.lifecycle = {};

    await expect(endorse(policy, "2027-02-01", setRoof(0, 10))).rejects.toThrow(
      /doesn't take out-of-sequence changes/,
    );

    release.lifecycle = { transactions: { endorsement: { outOfSequence: "reroll" } } };
  });
});
