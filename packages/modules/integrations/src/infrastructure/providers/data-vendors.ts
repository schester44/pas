import type { DataProvider, ProviderRequest, ProviderResponse } from "@pas/enrichment";
import { Money } from "@pas/kernel";
import { z } from "zod";
import type { ProviderPackage, ProviderSettings } from "../../ports/provider-catalog";
import { failure } from "./signing";

/*
 * Both vendors issue API access per customer and don't publish full API references. Endpoint
 * paths and field names below follow their public material; each adapter keeps its whole
 * request/response mapping in one pair of functions so a customer's contract docs fix it in one place.
 */

const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const num = (value: unknown) => {
  const n = typeof value === "string" ? Number(value) : value;

  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
};

const compact = (record: Record<string, unknown>): ProviderResponse =>
  Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));

function dataProvider(
  id: string,
  name: string,
  capability: "replacement_cost" | "hazard_scores",
  call: (request: ProviderRequest, signal: AbortSignal) => Promise<ProviderResponse>,
): DataProvider {
  return {
    manifest: {
      id,
      name,
      capabilities: [capability],
      configSchema: z.object({}),
      secrets: ["apiKey"],
      costPerCall: Money.of(0, "USD"),
      consumerReport: false,
    },
    fetch: (requested, request, { signal }) => {
      if (requested !== capability) throw new Error(`${name} doesn't supply ${requested}`);

      return call(request, signal);
    },
  };
}

const e2valueConfig = z.object({
  baseUrl: z
    .url()
    .default("https://api.e2value.com")
    .meta({ title: "API base URL", description: "From your E2Value onboarding." }),
  valuationType: z
    .enum(["residential", "condo", "manufactured"])
    .default("residential")
    .meta({ title: "Valuation type" }),
});

export function e2valueRequest(settings: ProviderSettings, request: ProviderRequest): Request {
  const config = e2valueConfig.parse(settings.config);

  return new Request(new URL("/v1/valuations", config.baseUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${settings.secrets.apiKey ?? ""}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      valuationType: config.valuationType,
      address: {
        street: text(request.street),
        city: text(request.city),
        state: text(request.state),
        zip: text(request.postalCode),
      },
      yearBuilt: num(request.yearBuilt),
      livingArea: num(request.squareFeet),
      constructionType: text(request.constructionType),
      stories: num(request.stories),
      quality: text(request.quality),
      roofType: text(request.roofType),
    }),
  });
}

export function e2valueResponse(body: Record<string, unknown>): ProviderResponse {
  const valuation = (body.valuation ?? body) as Record<string, unknown>;

  return compact({
    replacementCost: num(valuation.reconstructionCost ?? valuation.replacementCost),
    costPerSquareFoot: num(valuation.costPerSquareFoot),
    quality: text(valuation.quality),
    valuationId: text(valuation.id ?? body.id),
  });
}

export function e2valueProvider(fetchImpl: typeof fetch = fetch): ProviderPackage<"data"> {
  const create = (settings: ProviderSettings) =>
    dataProvider("e2value", "E2Value", "replacement_cost", async (request, signal) => {
      const response = await fetchImpl(e2valueRequest(settings, request), { signal });

      if (!response.ok) throw await failure(response);

      return e2valueResponse((await response.json()) as Record<string, unknown>);
    });

  return {
    manifest: {
      id: "e2value",
      name: "E2Value",
      vendor: "E2Value",
      category: "data",
      summary: "Replacement cost estimates from the address and building details.",
      description:
        "Estimates reconstruction cost from the address and the building's year built, square footage, construction, stories, quality and roof, for dwelling limits and insurance-to-value checks.",
      capabilities: ["Replacement cost", "Cost per square foot"],
      supplies: ["replacement_cost"],
      configSchema: e2valueConfig,
      secrets: [{ key: "apiKey", label: "API key" }],
      docsUrl: "https://www.e2value.com/",
      logo: { mark: "E2" },
      testMode: false,
      liveMode: true,
      certified: false,
      builtin: false,
      requiresCredentials: true,
      webhook: null,
    },
    create,
    async check(settings) {
      const config = e2valueConfig.parse(settings.config);

      const response = await fetchImpl(new URL("/v1/status", config.baseUrl), {
        headers: { authorization: `Bearer ${settings.secrets.apiKey ?? ""}` },
      });

      if (!response.ok) throw await failure(response);

      return { ok: true, detail: `${new URL(config.baseUrl).host} accepted the key` };
    },
  };
}

const hazardhubConfig = z.object({
  baseUrl: z.url().default("https://api.hazardhub.com").meta({ title: "API base URL" }),
});

export function hazardhubRequest(settings: ProviderSettings, request: ProviderRequest): Request {
  const config = hazardhubConfig.parse(settings.config);
  const url = new URL("/v1/risks", config.baseUrl);
  const latitude = num(request.latitude);
  const longitude = num(request.longitude);

  if (latitude !== undefined && longitude !== undefined) {
    url.searchParams.set("lat", String(latitude));
    url.searchParams.set("lng", String(longitude));
  } else {
    url.searchParams.set("address", text(request.street) ?? "");
    url.searchParams.set("city", text(request.city) ?? "");
    url.searchParams.set("state", text(request.state) ?? "");
    url.searchParams.set("zip", text(request.postalCode) ?? "");
  }

  return new Request(url, {
    headers: {
      authorization: `Token token=${settings.secrets.apiKey ?? ""}`,
      accept: "application/json",
    },
  });
}

const score = (body: Record<string, unknown>, key: string) => {
  const entry = body[key] as Record<string, unknown> | undefined;

  return text(entry?.score) ?? num(entry?.score);
};

export function hazardhubResponse(body: Record<string, unknown>): ProviderResponse {
  const at = (key: string) => body[key] as Record<string, unknown> | undefined;

  return compact({
    wildfireScore: score(body, "wildfire"),
    floodScore: score(body, "flood"),
    floodZone: text(at("fema_all_flood")?.zone ?? at("flood")?.zone),
    windScore: score(body, "wind"),
    hailScore: score(body, "hail"),
    hurricaneScore: score(body, "hurricane"),
    earthquakeScore: score(body, "earthquake"),
    crimeScore: score(body, "crime"),
    distanceToCoastMiles: num(at("distance_to_coast")?.distance),
    fireStationDistanceMiles: num(at("fire_station")?.distance),
    protectionClass: num(at("protection_class")?.class ?? at("protection_class")?.pc),
  });
}

export function hazardhubProvider(fetchImpl: typeof fetch = fetch): ProviderPackage<"data"> {
  const create = (settings: ProviderSettings) =>
    dataProvider("hazardhub", "HazardHub", "hazard_scores", async (request, signal) => {
      const response = await fetchImpl(hazardhubRequest(settings, request), { signal });

      if (!response.ok) throw await failure(response);

      return hazardhubResponse((await response.json()) as Record<string, unknown>);
    });

  return {
    manifest: {
      id: "hazardhub",
      name: "HazardHub",
      vendor: "Guidewire",
      category: "data",
      summary: "Property hazard scores: wildfire, flood, wind, hail, quake and more.",
      description:
        "Scores a location's wildfire, flood, wind, hail, hurricane, earthquake and crime risk, with distance to the coast and the nearest fire station, and protection class where available. Uses coordinates from geocoding when present, otherwise the address.",
      capabilities: [
        "Wildfire, flood, wind, hail",
        "Hurricane and earthquake",
        "Crime",
        "Distance to coast and fire station",
        "Protection class",
      ],
      supplies: ["hazard_scores"],
      configSchema: hazardhubConfig,
      secrets: [{ key: "apiKey", label: "API token" }],
      docsUrl: "https://www.guidewire.com/products/analytics/hazardhub",
      logo: { mark: "H" },
      testMode: false,
      liveMode: true,
      certified: false,
      builtin: false,
      requiresCredentials: true,
      webhook: null,
    },
    create,
    async check(settings) {
      const response = await fetchImpl(
        hazardhubRequest(settings, {
          street: "4600 Silver Hill Rd",
          city: "Washington",
          state: "DC",
          postalCode: "20233",
        }),
      );

      if (!response.ok) throw await failure(response);

      return { ok: true, detail: "Scored a sample address" };
    },
  };
}
