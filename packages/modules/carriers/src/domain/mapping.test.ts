import { ready } from "@pas/expressions";
import { beforeAll, describe, expect, it } from "vitest";
import { evaluateMapping, MappingError, renderTemplate } from "./mapping";
import { outcomeFrom } from "./outcome";

beforeAll(() => ready());

const input = {
  insured: { name: "Jordan Rivera" },
  coverages: [
    { code: "DWELLING", premium: { amount: "1840.00" } },
    { code: "PERSONAL_PROPERTY", premium: null },
  ],
};

describe("carrier mappings", () => {
  it("maps the canonical model into a carrier payload, keeping decimals exact", () => {
    const body = evaluateMapping(
      "{ applicant: input.insured.name, lines: map(filter(input.coverages, #.premium != null), { coverage: #.code, amount: number(#.premium.amount) * 1.07 }) }",
      { input },
    );

    expect(body).toEqual({
      applicant: "Jordan Rivera",
      lines: [{ coverage: "DWELLING", amount: 1968.8 }],
    });
  });

  it("renders path templates and names the failing expression", () => {
    expect(
      renderTemplate("/applications/{{ steps.submit.output.id }}/binds", {
        steps: { submit: { output: { id: "APP-1" } } },
      }),
    ).toBe("/applications/APP-1/binds");

    expect(() => evaluateMapping("input.", { input })).toThrow(MappingError);
  });

  it("reads a carrier's mapped output into the canonical outcome and reports what doesn't fit", () => {
    const { outcome, issues } = outcomeFrom({
      status: "quoted",
      reference: "APP-1",
      premium: {
        lines: [{ coverage: "DWELLING", amount: 1968.8 }, { amount: 5 }],
        taxesFees: [{ code: "FEE", amount: "35" }],
      },
      documents: [{ title: "Declarations", url: "/documents/1.pdf" }],
      messages: ["Bound subject to inspection"],
    });

    expect(outcome).toEqual({
      status: "quoted",
      reference: "APP-1",
      premium: {
        lines: [{ coverage: "DWELLING", amount: "1968.8" }],
        taxesFees: [{ code: "FEE", label: "FEE", amount: "35" }],
      },
      documents: [{ title: "Declarations", url: "/documents/1.pdf" }],
      messages: [{ text: "Bound subject to inspection" }],
    });

    expect(issues).toEqual(["premium.lines[1] needs a coverage and a numeric amount"]);
    expect(outcomeFrom({ status: "maybe" }).issues[0]).toContain("status must be one of");
  });
});
