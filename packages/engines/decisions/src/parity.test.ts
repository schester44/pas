import { ZenEngine } from "@gorules/zen-engine";
import { describe, expect, it } from "vitest";
import { type DecisionTableContent, evaluateDecision, type JdmDecision } from "./index";

const position = { x: 0, y: 0 };

const graph = (content: DecisionTableContent): JdmDecision =>
  ({
    nodes: [
      { id: "in", name: "Request", type: "inputNode", position },
      { id: "t", name: "Table", type: "decisionTableNode", content, position },
      { id: "out", name: "Response", type: "outputNode", position },
    ],
    edges: [
      { id: "e1", sourceId: "in", targetId: "t" },
      { id: "e2", sourceId: "t", targetId: "out" },
    ],
  }) as JdmDecision;

const underwriting = graph({
  hitPolicy: "collect",
  inputs: [
    { id: "roof", name: "Roof age", field: "property.roofAge" },
    { id: "coastal", name: "Coastal", field: "property.coastal" },
    { id: "distance", name: "Distance to coast", field: "property.distanceToCoast" },
    { id: "claims", name: "Prior claims", field: "priorClaims" },
    { id: "state", name: "State", field: "jurisdiction.subdivision" },
  ],
  outputs: [
    { id: "o", name: "Outcome", field: "outcome" },
    { id: "r", name: "Reason", field: "reasonCode" },
    { id: "f", name: "Factor", field: "factor" },
  ],
  rules: [
    { _id: "1", roof: "> 30", o: '"decline"', r: '"ROOF_MAX"', f: "1.5" },
    { _id: "2", roof: "[21..30]", coastal: "true", o: '"refer"', r: '"ROOF_COASTAL"', f: "1.25" },
    { _id: "3", distance: "< 1", o: '"decline"', r: '"COAST"', f: "0.035" },
    { _id: "4", distance: "[1..5)", o: '"refer"', r: '"COAST_REVIEW"', f: "1.1" },
    { _id: "5", claims: ">= 3", o: '"decline"', r: '"CLAIMS"', f: "2" },
    {
      _id: "6",
      state: 'in ["US-IL", "US-IN"]',
      claims: "[1..2]",
      o: '"info_needed"',
      r: '"DETAIL"',
      f: "1",
    },
    { _id: "7", state: '"US-TX"', o: '"decline"', r: '"STATE"', f: "0" },
  ],
});

const firstHit = graph({
  ...(underwriting.nodes[1]!.content as DecisionTableContent),
  hitPolicy: "first",
});

const risks = [
  {},
  { property: { roofAge: 24, coastal: true, distanceToCoast: 8 }, priorClaims: 0 },
  { property: { roofAge: 31, coastal: false, distanceToCoast: 0.5 }, priorClaims: 4 },
  {
    property: { roofAge: 21, coastal: true, distanceToCoast: 1 },
    priorClaims: 2,
    jurisdiction: { subdivision: "US-IL" },
  },
  {
    property: { roofAge: 30, coastal: false, distanceToCoast: 5 },
    priorClaims: 1,
    jurisdiction: { subdivision: "US-IN" },
  },
  { property: { roofAge: 12.5, distanceToCoast: 4.99 }, jurisdiction: { subdivision: "US-TX" } },
];

const native = new ZenEngine();

async function nativeResult(jdm: JdmDecision, input: object): Promise<unknown> {
  const decision = native.createDecision(Buffer.from(JSON.stringify(jdm)));

  return (await decision.evaluate(input)).result;
}

describe("decision interpreter matches the native ZEN engine", () => {
  for (const [name, jdm] of [
    ["collect", underwriting],
    ["first", firstHit],
  ] as const) {
    it.each(risks.map((risk, index) => [index, risk] as const))(
      `${name} hit policy, risk %i`,
      async (_, risk) => {
        const ours = evaluateDecision("custom", jdm, risk).raw;

        expect(ours).toEqual(await nativeResult(jdm, risk));
      },
    );
  }
});
