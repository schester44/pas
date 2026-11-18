import { asId, systemClock } from "@pas/kernel";
import { describe, expect, it } from "vitest";
import { InMemoryEnrichmentCache } from "./cache";
import { enrichmentPlanSchema } from "./plan";
import { createProviderRegistry } from "./provider";
import { createFakeDataProvider } from "./providers/fake";
import { runEnrichmentStage } from "./run-stage";

describe("runEnrichmentStage", () => {
  it("falls back past failing providers, keeps user values and reports discrepancies", async () => {
    const backup = createFakeDataProvider({ id: "backup" });

    const plan = enrichmentPlanSchema.parse({
      stages: {
        prefill: [
          {
            id: "geocode",
            capability: "geocode",
            providers: ["down", "backup"],
            request: { address: "address" },
            response: { latitude: "location.latitude", countyFips: "location.countyFips" },
            mode: "prefill",
            costClass: "free",
          },
          {
            id: "property",
            capability: "property_characteristics",
            providers: ["slow", "backup"],
            request: { address: "address" },
            response: { yearBuilt: "building.yearBuilt", roofYear: "building.roofYear" },
            mode: "authoritative",
            costClass: "low",
            timeoutMs: 20,
          },
        ],
      },
    });

    const address = "12 Main St, Springfield, 01101";

    const expected = await backup.fetch(
      "property_characteristics",
      { address },
      {
        signal: new AbortController().signal,
      },
    );

    const result = await runEnrichmentStage(
      plan,
      "prefill",
      {
        data: { address, building: { yearBuilt: 1890 } },
        userEntered: new Set(["address", "building.yearBuilt"]),
      },
      {
        tenantId: asId("tenant-1"),
        providers: createProviderRegistry([
          createFakeDataProvider({ id: "down", failing: true }),
          createFakeDataProvider({ id: "slow", delayMs: 500 }),
          backup,
        ]),
        cache: new InMemoryEnrichmentCache(systemClock),
        clock: systemClock,
      },
    );

    expect(
      result.calls.map(({ callId, providerId, outcome }) => [callId, providerId, outcome]),
    ).toEqual([
      ["geocode", "down", "error"],
      ["geocode", "backup", "ok"],
      ["property", "slow", "timeout"],
      ["property", "backup", "ok"],
    ]);

    expect(result.snapshot.entries.map((entry) => entry.providerId)).toEqual(["backup", "backup"]);

    expect(result.prefills.map((prefill) => prefill.path)).toEqual([
      "location.latitude",
      "location.countyFips",
      "building.roofYear",
    ]);

    expect(result.discrepancies).toEqual([
      {
        path: "building.yearBuilt",
        callId: "property",
        providerId: "backup",
        mode: "authoritative",
        userValue: 1890,
        providerValue: expected.yearBuilt,
      },
    ]);
  });

  it("merges providers field by field with provenance, after the calls it depends on", async () => {
    const stub = (id: string, response: Record<string, unknown>) => ({
      ...createFakeDataProvider({ id }),
      fetch: async (_capability: string, request: Record<string, unknown>) => {
        seen.push([id, request]);

        return response;
      },
    });

    const seen: [string, Record<string, unknown>][] = [];

    const plan = enrichmentPlanSchema.parse({
      stages: {
        pre_rate: [
          {
            id: "hazards",
            capability: "hazard_scores",
            providers: ["hazardhub", "other"],
            combine: "merge",
            fieldSources: { floodZone: "other" },
            dependsOn: ["geocode"],
            request: { latitude: "location.latitude" },
            response: {
              wildfireScore: "hazard.wildfire",
              floodZone: "hazard.floodZone",
              crimeScore: "hazard.crime",
            },
            mode: "uw_only",
            costClass: "medium",
          },
          {
            id: "geocode",
            capability: "geocode",
            providers: ["census"],
            request: { address: "address" },
            response: { latitude: "location.latitude" },
            mode: "prefill",
            costClass: "free",
          },
        ],
      },
    });

    const result = await runEnrichmentStage(
      plan,
      "pre_rate",
      { data: { address: "1 Elm St" }, userEntered: new Set(["address"]) },
      {
        tenantId: asId("tenant-1"),
        providers: createProviderRegistry([
          stub("census", { latitude: 41.5 }),
          stub("hazardhub", { wildfireScore: 12, floodZone: "X", crimeScore: null }),
          stub("other", { wildfireScore: 80, floodZone: "AE", crimeScore: 7 }),
        ]),
        cache: new InMemoryEnrichmentCache(systemClock),
        clock: systemClock,
      },
    );

    expect(seen[0]).toEqual(["census", { address: "1 Elm St" }]);

    expect(seen.slice(1).map(([, request]) => request)).toEqual([
      { latitude: 41.5 },
      { latitude: 41.5 },
    ]);

    const hazards = result.snapshot.entries.find((entry) => entry.callId === "hazards")!;

    expect(hazards.response).toEqual({ wildfireScore: 12, floodZone: "AE", crimeScore: 7 });

    expect(hazards.provenance).toEqual({
      wildfireScore: "hazardhub",
      floodZone: "other",
      crimeScore: "other",
    });
  });
});
