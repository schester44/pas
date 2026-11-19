import { evaluateDecision, type JdmDecision } from "@pas/decisions-engine";
import { jurisdiction } from "@pas/kernel";
import { describe, expect, it } from "vitest";
import { draftsForTransaction, filingDecisionInput } from "./obligation-rules";

const columns = ["kind", "code", "title", "dueDays", "dueFrom", "channel"] as const;

const filingRules: JdmDecision = {
  nodes: [
    { id: "in", name: "Request", type: "inputNode" },
    {
      id: "t",
      name: "Filings",
      type: "decisionTableNode",
      content: {
        hitPolicy: "collect",
        inputs: [
          { id: "market", name: "Market", field: "market" },
          { id: "home", name: "Home state", field: "homeState" },
          { id: "type", name: "Transaction", field: "transaction.type" },
          { id: "bearing", name: "Premium bearing", field: "transaction.premiumBearing" },
          { id: "affidavit", name: "File affidavit", field: "diligentSearch.fileAffidavit" },
        ],
        outputs: columns.map((field) => ({ id: field, name: field, field })),
        rules: [
          {
            _id: "1",
            market: '"non_admitted"',
            home: '"US-IL"',
            type: '"new_business"',
            kind: '"sl_filing"',
            code: '"IL_SL_FILING"',
            title: '"Surplus lines filing"',
            dueDays: "90",
            dueFrom: '"effective"',
            channel: '"api"',
          },
          {
            _id: "2",
            market: '"non_admitted"',
            home: '"US-IL"',
            type: '"endorsement"',
            bearing: "true",
            kind: '"sl_filing"',
            code: '"IL_SL_FILING"',
            title: '"Surplus lines filing"',
            dueDays: "90",
            dueFrom: '"later_of_effective_issue"',
            channel: '"api"',
          },
          {
            _id: "3",
            market: '"non_admitted"',
            home: '"US-IL"',
            type: '"new_business"',
            affidavit: "true",
            kind: '"sl_affidavit"',
            code: '"IL_SL_AFFIDAVIT"',
            title: '"Diligent search affidavit"',
            dueDays: "90",
            dueFrom: '"effective"',
            channel: '"api"',
          },
        ],
      },
    },
    { id: "out", name: "Response", type: "outputNode" },
  ],
  edges: [
    { id: "e1", sourceId: "in", targetId: "t" },
    { id: "e2", sourceId: "t", targetId: "out" },
  ],
};

const il = jurisdiction("US", "US-IL");

const issued = (type: string, amount: string, effective: string, issuedOn: string) => ({
  type,
  premium: { amount, currency: "USD" },
  effectiveDate: Temporal.PlainDate.from(effective),
  issuedDate: Temporal.PlainDate.from(issuedOn),
});

function obligationsFor(
  market: string,
  transaction: ReturnType<typeof issued>,
  fileAffidavit = true,
) {
  const input = filingDecisionInput({
    risk: {},
    jurisdiction: il,
    market,
    homeState: "US-IL",
    transaction,
    diligentSearch: { required: true, timing: "post_bind", fileAffidavit },
  });

  const { obligations } = evaluateDecision("filing_obligations", filingRules, input).result;

  return draftsForTransaction(obligations, { homeState: "US-IL", transaction }).map((o) => [
    o.kind,
    o.dueDate.toString(),
    o.jurisdiction.subdivision,
  ]);
}

describe("filing obligations for a non-admitted transaction", () => {
  it("files new business and the affidavit the diligent search requires", () => {
    expect(
      obligationsFor("non_admitted", issued("NEW_BUSINESS", "1200", "2027-12-01", "2027-11-20")),
    ).toEqual([
      ["sl_filing", "2028-02-29", "US-IL"],
      ["sl_affidavit", "2028-02-29", "US-IL"],
    ]);

    expect(
      obligationsFor(
        "non_admitted",
        issued("NEW_BUSINESS", "1200", "2027-12-01", "2027-11-20"),
        false,
      ),
    ).toEqual([["sl_filing", "2028-02-29", "US-IL"]]);
  });

  it("files premium-bearing endorsements from the later of effective and issue", () => {
    expect(
      obligationsFor("non_admitted", issued("ENDORSEMENT", "150", "2028-01-10", "2028-02-01")),
    ).toEqual([["sl_filing", "2028-05-01", "US-IL"]]);

    expect(
      obligationsFor("non_admitted", issued("ENDORSEMENT", "0", "2028-01-10", "2028-02-01")),
    ).toEqual([]);
  });

  it("owes nothing on admitted business", () => {
    expect(
      obligationsFor("admitted", issued("NEW_BUSINESS", "1200", "2027-12-01", "2027-11-20")),
    ).toEqual([]);
  });
});
