import { describe, expect, it } from "vitest";
import { type AddressUsage, clearanceModeFrom, decideClearance } from "./clearance";

const usage = (over: Partial<AddressUsage> & Pick<AddressUsage, "subject">): AddressUsage => ({
  addressId: "a1",
  label: over.subject.id,
  role: "location",
  productId: "p1",
  producer: { id: "other", name: "Other Producer" },
  active: true,
  ...over,
});

const usages = [
  usage({ subject: { kind: "submission", id: "SUB-1" } }),
  usage({ subject: { kind: "policy", id: "POL-1" } }),
  usage({ subject: { kind: "submission", id: "SUB-2" }, producer: { id: "me", name: "Me" } }),
  usage({ subject: { kind: "submission", id: "SUB-3" }, active: false }),
  usage({ subject: { kind: "policy", id: "POL-2" }, role: "mailing" }),
  usage({ subject: { kind: "submission", id: "SUB-4" }, addressId: "a2" }),
  usage({ subject: { kind: "submission", id: "MINE" }, producer: null }),
];

const check = (mode: "block" | "warn" | "off", addressIds = ["a1"]) =>
  decideClearance({
    mode,
    subject: { kind: "submission", id: "MINE" },
    producerId: "me",
    addressIds,
    usages,
  });

describe("clearance", () => {
  it("flags active locations of other producers only", () => {
    const result = check("warn");

    expect(result.outcome).toBe("warn");
    expect(result.conflicts.map((c) => c.subject.id)).toEqual(["SUB-1", "POL-1"]);
  });

  it("blocks, warns or stays out of the way per the product's mode", () => {
    expect(check("block").outcome).toBe("block");
    expect(check("off")).toEqual({ mode: "off", outcome: "clear", conflicts: [] });
    expect(check("block", ["a3"]).outcome).toBe("clear");
  });

  it("ignores the subject's own related records", () => {
    const result = decideClearance({
      mode: "warn",
      subject: { kind: "submission", id: "MINE" },
      related: [{ kind: "policy", id: "POL-1" }],
      producerId: "me",
      addressIds: ["a1"],
      usages,
    });

    expect(result.conflicts.map((c) => c.subject.id)).toEqual(["SUB-1"]);
  });

  it("defaults to warn and reads the product's lifecycle setting", () => {
    expect(clearanceModeFrom({})).toBe("warn");
    expect(clearanceModeFrom({ clearance: { duplicateRisk: "block" } })).toBe("block");
    expect(clearanceModeFrom({ clearance: { duplicateRisk: "nonsense" } })).toBe("warn");
  });
});
