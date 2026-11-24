import { describe, expect, it } from "vitest";
import { assertCompletes, completionRules, insuredCompletesAny } from "./completion";

describe("completion rules", () => {
  it("leaves every step with the producer when the release configures none", () => {
    const rules = completionRules({});

    expect(rules).toEqual({ disclosures: "producer", signature: "producer", payment: "producer" });
    expect(insuredCompletesAny(rules)).toBe(false);
  });

  it("reads each step on its own, so letting producers pay leaves signing with the insured", () => {
    const rules = completionRules({
      completion: { disclosures: "insured", signature: "insured", payment: "either" },
    });

    expect(() => assertCompletes(rules, "payment", "producer")).not.toThrow();
    expect(() => assertCompletes(rules, "payment", "insured")).not.toThrow();
    expect(() => assertCompletes(rules, "signature", "producer")).toThrow(/insured signs/);
    expect(() => assertCompletes(rules, "disclosures", "producer")).toThrow(/insured accepts/);
  });

  it("rejects an insured paying where only the producer collects", () => {
    const rules = completionRules({ completion: { signature: "insured", payment: "nonsense" } });

    expect(rules.payment).toBe("producer");
    expect(() => assertCompletes(rules, "payment", "insured")).toThrow(/producer pays/);
  });
});
