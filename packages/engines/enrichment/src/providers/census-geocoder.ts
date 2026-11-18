import { Money } from "@pas/kernel";
import { z } from "zod";
import type { DataProvider, ProviderRequest, ProviderResponse } from "../provider";

export const censusGeocoderConfigSchema = z.object({
  baseUrl: z.url().default("https://geocoding.geo.census.gov/geocoder"),
  benchmark: z.string().default("Public_AR_Current"),
  vintage: z.string().default("Current_Current"),
  timeoutMs: z.number().int().positive().default(4000),
  retries: z.number().int().min(0).max(3).default(1),
});

export type CensusGeocoderConfig = z.input<typeof censusGeocoderConfigSchema>;

const LAYERS = ["States", "Counties", "Incorporated Places", "County Subdivisions"];

const geography = z.looseObject({
  GEOID: z.string(),
  NAME: z.string(),
  STUSAB: z.string().optional(),
});

const responseSchema = z.object({
  result: z.object({
    addressMatches: z.array(
      z.object({
        matchedAddress: z.string(),
        coordinates: z.object({ x: z.number(), y: z.number() }),
        geographies: z.record(z.string(), z.array(geography)).default({}),
      }),
    ),
  }),
});

/** US Census Bureau geocoder: free, keyless, US addresses only. */
export function createCensusGeocoder(
  config: CensusGeocoderConfig = {},
  fetchImpl: typeof fetch = fetch,
): DataProvider {
  const settings = censusGeocoderConfigSchema.parse(config);

  return {
    manifest: {
      id: "census-geocoder",
      name: "US Census Geocoder",
      capabilities: ["geocode"],
      configSchema: censusGeocoderConfigSchema,
      secrets: [],
      costPerCall: Money.of(0, "USD"),
      consumerReport: false,
    },
    async fetch(_capability, request, { signal }) {
      const url = new URL(`${settings.baseUrl}/geographies/onelineaddress`);

      url.search = new URLSearchParams({
        address: oneLineAddress(request),
        benchmark: settings.benchmark,
        vintage: settings.vintage,
        layers: LAYERS.join(","),
        format: "json",
      }).toString();

      return toResponse(await getJson(url, signal));
    },
  };

  async function getJson(url: URL, signal: AbortSignal): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await fetchImpl(url, {
          signal: AbortSignal.any([signal, AbortSignal.timeout(settings.timeoutMs)]),
          headers: { accept: "application/json" },
        });

        if (response.ok) return await response.json();

        if (response.status < 500)
          throw new PermanentError(`Census geocoder returned ${response.status}`);

        throw new Error(`Census geocoder returned ${response.status}`);
      } catch (error) {
        // The service is intermittently slow or 5xx; retry those, but never past the caller's deadline.
        if (error instanceof PermanentError || signal.aborted || attempt >= settings.retries)
          throw error;
      }
    }
  }
}

class PermanentError extends Error {}

function oneLineAddress(request: ProviderRequest): string {
  if (typeof request.address === "string") return request.address;

  const parts = [request.street, request.city, request.state, request.postalCode];

  return parts.filter((part) => typeof part === "string" && part.trim()).join(", ");
}

function toResponse(body: unknown): ProviderResponse {
  const match = responseSchema.parse(body).result.addressMatches[0];

  if (!match) return { matched: false };

  const first = (layer: string) => match.geographies[layer]?.[0];
  const state = first("States");
  const county = first("Counties");
  const place = first("Incorporated Places");
  const subdivision = first("County Subdivisions");

  return {
    matched: true,
    matchedAddress: match.matchedAddress,
    latitude: match.coordinates.y,
    longitude: match.coordinates.x,
    stateFips: state?.GEOID,
    stateCode: state?.STUSAB,
    countyFips: county?.GEOID,
    countyName: county?.NAME,
    placeFips: place?.GEOID,
    placeName: place?.NAME,
    countySubdivisionFips: subdivision?.GEOID,
    countySubdivisionName: subdivision?.NAME,
  };
}
