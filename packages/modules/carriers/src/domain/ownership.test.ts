import { Money } from "@pas/kernel";
import { describe, expect, it } from "vitest";
import { carrierAssignmentOf, reconcileFigures, requiredCapabilities } from "./ownership";

const line = (key: string, amount: string) => ({ key, label: key, amount: Money.of(amount) });

describe("ownership matrix", () => {
  it("carrier figures win: the carrier's lines replace ours and the diff explains each move", () => {
    const { lines, diff } = reconcileFigures(
      [line("DWELLING", "1216"), line("LIABILITY", "72"), line("STATE_FEE", "25")],
      [line("DWELLING", "1301.12"), line("LIABILITY", "72"), line("CARRIER_FEE", "35")],
      "USD",
    );

    expect(lines.map((l) => [l.key, l.amount.toString()])).toEqual([
      ["DWELLING", "1301.12"],
      ["LIABILITY", "72"],
      ["CARRIER_FEE", "35"],
    ]);

    expect(diff).toEqual({
      currency: "USD",
      changes: [
        {
          key: "DWELLING",
          label: "DWELLING",
          pas: "1216",
          carrier: "1301.12",
          difference: "85.12",
        },
        { key: "STATE_FEE", label: "STATE_FEE", pas: "25", carrier: null, difference: "-25" },
        { key: "CARRIER_FEE", label: "CARRIER_FEE", pas: null, carrier: "35", difference: "35" },
      ],
      pasTotal: "1313",
      carrierTotal: "1408.12",
      difference: "95.12",
    });
  });

  it("reads the assignment from lifecycle config and derives the capabilities it needs", () => {
    const assignment = carrierAssignmentOf({
      carrier: {
        carrier: "lakeside",
        ownership: {
          rating: "carrier",
          transactions: { new_business: "carrier", cancellation: "carrier_with_mirror" },
        },
      },
    });

    expect(assignment?.ownership.transactions).toEqual({
      new_business: "carrier",
      endorsement: "pas",
      cancellation: "carrier_with_mirror",
      reinstatement: "pas",
    });

    expect(requiredCapabilities(assignment!.ownership)).toEqual(["quote", "bind", "issue"]);
    expect(carrierAssignmentOf({})).toBeNull();
  });
});
