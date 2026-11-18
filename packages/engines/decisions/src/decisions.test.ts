import { describe, expect, it } from "vitest";
import {
  type DecisionError,
  checkDecision,
  type DecisionTableContent,
  evaluateDecision,
  type JdmDecision,
  overallOutcome,
} from "./index";

const table = (content: DecisionTableContent): JdmDecision => ({
  nodes: [
    { id: "in", name: "Request", type: "inputNode" },
    { id: "t", name: "Table", type: "decisionTableNode", content },
    { id: "out", name: "Response", type: "outputNode" },
  ],
  edges: [
    { id: "e1", sourceId: "in", targetId: "t" },
    { id: "e2", sourceId: "t", targetId: "out" },
  ],
});

const roofRules = table({
  hitPolicy: "collect",
  inputs: [
    { id: "roof", name: "Roof age", field: "property.roofAge" },
    { id: "coastal", name: "Coastal", field: "property.coastal" },
    { id: "claims", name: "Prior claims", field: "priorClaims" },
  ],
  outputs: [
    { id: "o", name: "Outcome", field: "outcome" },
    { id: "r", name: "Reason", field: "reasonCode" },
    { id: "m", name: "Message", field: "message" },
  ],
  rules: [
    { _id: "1", roof: "> 20", coastal: "true", o: '"refer"', r: '"ROOF"', m: '"Old roof"' },
    { _id: "2", claims: ">= 3", o: '"decline"', r: '"CLAIMS"', m: '"Too many claims"' },
    { _id: "3", claims: "[1..2]", o: '"info_needed"', r: '"DETAIL"', m: '"Describe claims"' },
  ],
});

describe("decisions engine", () => {
  it("ranks underwriting outcomes decline > refer > info_needed > pass", () => {
    expect(overallOutcome([])).toBe("pass");
    expect(overallOutcome([{ outcome: "info_needed" }, { outcome: "pass" }])).toBe("info_needed");
    expect(overallOutcome([{ outcome: "info_needed" }, { outcome: "refer" }])).toBe("refer");
    expect(overallOutcome([{ outcome: "refer" }, { outcome: "decline" }])).toBe("decline");
  });

  it("collects every matching row and aggregates underwriting outcomes", () => {
    const risk = { property: { roofAge: 24, coastal: true }, priorClaims: 2 };
    const { result, trace } = evaluateDecision("underwriting", roofRules, risk, { trace: true });

    expect(result.overall).toBe("refer");

    expect(result.outcomes.map((o) => [o.rule, o.outcome])).toEqual([
      ["ROOF", "refer"],
      ["DETAIL", "info_needed"],
    ]);

    expect((trace!.t!.traceData as { index: number }[]).map((hit) => hit.index)).toEqual([0, 2]);

    const missing = evaluateDecision("underwriting", roofRules, { priorClaims: 5 });
    expect(missing.result.overall).toBe("decline");
  });

  it("stops at the first matching row and keeps decimals exact", () => {
    const taxes = table({
      hitPolicy: "first",
      inputs: [{ id: "s", name: "State", field: "jurisdiction.subdivision" }],
      outputs: [
        { id: "c", name: "Code", field: "code" },
        { id: "l", name: "Label", field: "label" },
        { id: "rate", name: "Rate", field: "rate" },
        { id: "b", name: "Basis", field: "basis" },
        { id: "t", name: "Taxable", field: "taxable" },
        { id: "w", name: "Remitter", field: "remitter" },
      ],
      rules: [
        { _id: "il", s: '"US-IL"', c: '"SL"', l: '"SL tax"', rate: "0.035" },
        { _id: "any", c: '"SL"', l: '"SL tax"', rate: "0.03" },
      ].map((rule) => ({ ...rule, b: '"premium"', t: "false", w: '"licensee"' })),
    });

    const il = evaluateDecision("taxes_fees", taxes, { jurisdiction: { subdivision: "US-IL" } });

    expect(il.result.lines).toEqual([
      expect.objectContaining({ code: "SL", rate: "0.035", remitter: "licensee" }),
    ]);

    const other = evaluateDecision("taxes_fees", taxes, { jurisdiction: { subdivision: "US-IN" } });
    expect(other.result.lines.map((line) => line.rate)).toEqual(["0.03"]);
  });

  it("detects output contract violations statically and at runtime", () => {
    const broken = table({
      hitPolicy: "collect",
      inputs: [{ id: "roof", name: "Roof age", field: "property.roofAge" }],
      outputs: [
        { id: "o", name: "Outcome", field: "outcome" },
        { id: "m", name: "Message", field: "message" },
      ],
      rules: [{ _id: "1", roof: "> 20", o: '"maybe"', m: '"Old roof"' }],
    });

    const issues = checkDecision("underwriting", broken, ["property.roofAge"]);

    expect(issues.map((issue) => [issue.code, issue.path ?? issue.columnId])).toEqual(
      expect.arrayContaining([
        ["missing_output", "reasonCode"],
        ["invalid_output", "o"],
      ]),
    );

    expect(checkDecision("underwriting", roofRules, ["property.roofAge"])).toEqual([
      expect.objectContaining({ code: "unknown_field", path: "property.coastal" }),
      expect.objectContaining({ code: "unknown_field", path: "priorClaims" }),
    ]);

    expect(() =>
      evaluateDecision("underwriting", broken, { property: { roofAge: 30 } }),
    ).toThrowError(expect.objectContaining({ code: "contract_violation" }) as DecisionError);
  });
});
