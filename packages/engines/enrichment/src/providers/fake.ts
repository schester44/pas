import { canonicalJson, Money } from "@pas/kernel";
import { z } from "zod";
import type { ProviderCapability } from "../plan";
import type { DataProvider, ProviderRequest, ProviderResponse } from "../provider";

export interface FakeProviderOptions {
  id?: string;
  name?: string;
  capabilities?: readonly ProviderCapability[];
  /** Simulates an outage: every call rejects. */
  failing?: boolean;
  delayMs?: number;
}

const ALL: readonly ProviderCapability[] = [
  "geocode",
  "property_characteristics",
  "hazard_scores",
  "tax_jurisdiction",
  "replacement_cost",
];

/** Deterministic, plausible data derived from the request, for sandboxes, demos and tests. */
export function createFakeDataProvider(options: FakeProviderOptions = {}): DataProvider {
  const id = options.id ?? "fake";

  return {
    manifest: {
      id,
      name: options.name ?? "Sandbox data",
      capabilities: options.capabilities ?? ALL,
      configSchema: z.object({}),
      secrets: [],
      costPerCall: Money.of(0, "USD"),
      consumerReport: false,
    },
    async fetch(capability, request, { signal }) {
      if (options.delayMs) await sleep(options.delayMs, signal);

      if (options.failing) throw new Error(`${id} is unavailable`);

      return GENERATORS[capability](random(request));
    },
  };
}

const GENERATORS: Record<ProviderCapability, (next: () => number) => ProviderResponse> = {
  geocode: (next) => {
    const state = 1 + Math.floor(next() * 56);
    const county = 1 + 2 * Math.floor(next() * 100);

    return {
      latitude: round(25 + next() * 23, 6),
      longitude: round(-124 + next() * 57, 6),
      stateFips: pad(state, 2),
      countyFips: `${pad(state, 2)}${pad(county, 3)}`,
      countyName: `Sandbox County ${county}`,
      placeFips: pad(Math.floor(next() * 99_999), 5),
      placeName: `Sandbox City ${Math.floor(next() * 500)}`,
    };
  },
  property_characteristics: (next) => {
    const yearBuilt = 1950 + Math.floor(next() * 73);

    return {
      yearBuilt,
      squareFeet: 900 + Math.floor(next() * 3600),
      stories: 1 + Math.floor(next() * 3),
      constructionType: pick(next, ["frame", "masonry", "masonry_veneer", "fire_resistive"]),
      roofType: pick(next, ["asphalt_shingle", "tile", "metal", "slate", "wood_shake"]),
      roofYear: yearBuilt + Math.floor(next() * (2024 - yearBuilt)),
    };
  },
  hazard_scores: (next) => ({
    wildfireScore: 1 + Math.floor(next() * 100),
    windScore: 1 + Math.floor(next() * 100),
    hailScore: 1 + Math.floor(next() * 100),
    hurricaneScore: 1 + Math.floor(next() * 100),
    earthquakeScore: 1 + Math.floor(next() * 100),
    crimeScore: 1 + Math.floor(next() * 100),
    floodZone: pick(next, ["X", "X500", "AE", "A", "VE"]),
    distanceToCoastMiles: round(next() * 400, 1),
    fireStationDistanceMiles: round(next() * 12, 1),
    protectionClass: 1 + Math.floor(next() * 10),
  }),
  replacement_cost: (next) => {
    const squareFeet = 900 + Math.floor(next() * 3600);
    const perSquareFoot = 140 + Math.floor(next() * 160);

    return {
      replacementCost: Math.round((squareFeet * perSquareFoot) / 100) * 100,
      costPerSquareFoot: perSquareFoot,
      quality: pick(next, ["economy", "standard", "custom", "premium"]),
    };
  },
  tax_jurisdiction: (next) => ({
    taxDistrictCode: `SBX-${pad(Math.floor(next() * 9999), 4)}`,
    municipality: `Sandbox City ${Math.floor(next() * 500)}`,
    insideCityLimits: next() > 0.3,
  }),
};

function random(request: ProviderRequest): () => number {
  let seed = 2166136261;

  for (const char of canonicalJson(request).toUpperCase()) {
    seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  }

  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(next: () => number, values: readonly T[]): T =>
  values[Math.floor(next() * values.length)]!;

const pad = (value: number, length: number) => String(value).padStart(length, "0");

const round = (value: number, places: number) => Number(value.toFixed(places));

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);

    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });
}
