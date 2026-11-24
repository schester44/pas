import { describe, expect, it } from "vitest";
import { prefillTarget } from "./extensions";

describe("prefillTarget", () => {
  it("keeps top-level paths and lands row paths in the trigger's row", () => {
    expect(prefillTarget("business.name", "dot", "dot")).toBe("business.name");

    expect(prefillTarget("vehicles[].model", "vehicles[#a1].vin", "vehicles[].vin")).toBe(
      "vehicles[#a1].model",
    );

    expect(prefillTarget("fleet.size", "vehicles[#a1].vin", "vehicles[].vin")).toBe("fleet.size");
  });

  it("drops row paths it can't place", () => {
    expect(prefillTarget("drivers[].name", "vehicles[#a1].vin", "vehicles[].vin")).toBeNull();
    expect(prefillTarget("vehicles[].model", "dot", "dot")).toBeNull();
  });
});
