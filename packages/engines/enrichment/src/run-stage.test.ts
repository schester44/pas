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
        source: "call.property.yearBuilt",
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

  it("runs transforms, then derivations, then mappings, keeping user values and blocking on failure", async () => {
    const plan = enrichmentPlanSchema.parse({
      stages: {
        pre_rate: [
          {
            id: "rce",
            capability: "replacement_cost",
            providers: ["vendor"],
            request: { address: "address" },
            response: {},
            mode: "prefill",
            costClass: "medium",
          },
        ],
      },
      transforms: [
        {
          id: "adjust",
          stage: "pre_rate",
          extension: { key: "rce-adjust", version: "3" },
          reads: ["call.rce.replacementCost", "derived.region"],
          writes: ["adjustedCost"],
        },
        {
          id: "optional",
          stage: "pre_rate",
          extension: { key: "broken" },
          writes: ["x"],
          onFailure: "skip",
        },
      ],
      derivations: [
        { id: "coverageA", stage: "pre_rate", expression: "transform.adjust.adjustedCost * 1.1" },
        { id: "broken", stage: "pre_rate", expression: "nope(" },
      ],
      mappings: [
        { from: "call.rce.replacementCost", to: "building.rce", mode: "uw_only" },
        { from: "derived.coverageA", to: "coverages.dwelling", mode: "prefill" },
        { from: "transform.adjust.adjustedCost", to: "building.adjustedRce", mode: "prefill" },
      ],
    });

    const seen: unknown[] = [];

    const run = (failAdjust: boolean) =>
      runEnrichmentStage(
        plan,
        "pre_rate",
        {
          data: { address: "1 Elm St", building: { adjustedRce: 1000 } },
          userEntered: new Set(["address", "building.adjustedRce"]),
          prior: { call: {}, transform: {}, derived: { region: "coastal" } },
        },
        {
          tenantId: asId("tenant-1"),
          providers: createProviderRegistry([
            {
              ...createFakeDataProvider({ id: "vendor" }),
              fetch: async () => ({ replacementCost: 400_000 }),
            },
          ]),
          cache: new InMemoryEnrichmentCache(systemClock),
          clock: systemClock,
          transforms: {
            run: async (transform, input) => {
              seen.push(input.sources);

              if (transform.id === "optional") return { ok: false, error: "boom", logs: [] };

              return failAdjust
                ? { ok: true, values: { adjustedCost: 1, extra: 2 }, logs: [] }
                : {
                    ok: true,
                    values: {
                      adjustedCost: (input.sources["call.rce.replacementCost"] as number) * 2,
                    },
                    logs: ["doubled"],
                  };
            },
          },
        },
      );

    const result = await run(false);

    expect(seen[0]).toEqual({ "call.rce.replacementCost": 400_000, "derived.region": "coastal" });
    expect(result.snapshot.entries[0]!.response).toEqual({ replacementCost: 400_000 });
    expect(result.snapshot.transforms.map((t) => t.outcome)).toEqual(["ok", "error"]);
    expect(result.snapshot.derived).toEqual({ coverageA: 880_000 });
    expect(result.snapshot.derivationErrors.map((e) => e.derivationId)).toEqual(["broken"]);
    expect(result.blocked).toBeUndefined();

    expect(result.prefills.map(({ path, value, source }) => [path, value, source])).toEqual([
      ["coverages.dwelling", 880_000, "derived.coverageA"],
    ]);

    expect(result.discrepancies).toEqual([
      {
        path: "building.adjustedRce",
        source: "transform.adjust.adjustedCost",
        providerId: null,
        mode: "prefill",
        userValue: 1000,
        providerValue: 800_000,
      },
    ]);

    const failed = await run(true);

    expect(failed.snapshot.transforms[0]!.outcome).toBe("invalid_output");
    expect(failed.blocked?.transformId).toBe("adjust");
    expect(failed.prefills).toEqual([]);
  });
});
