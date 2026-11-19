import { z } from "zod";
import type { AddressProvider, SuggestQuery } from "./address";

export interface GeoapifySettings {
  apiKey: string;
  url?: string;
  timeoutMs?: number;
}

const URL_DEFAULT = "https://api.geoapify.com/v1/geocode/autocomplete";

const resultsSchema = z.object({
  results: z
    .array(
      z.looseObject({
        housenumber: z.string().optional(),
        street: z.string().optional(),
        address_line1: z.string().optional(),
        city: z.string().optional(),
        state_code: z.string().optional(),
        postcode: z.string().optional(),
        country_code: z.string().optional(),
      }),
    )
    .default([]),
});

export function geoapifyRequest(settings: GeoapifySettings, query: SuggestQuery): URL {
  const url = new URL(settings.url ?? URL_DEFAULT);

  url.search = new URLSearchParams({
    text: query.text,
    filter: `countrycode:${query.country.toLowerCase()}`,
    format: "json",
    limit: String(query.limit),
    apiKey: settings.apiKey,
  }).toString();

  return url;
}

/**
 * Geoapify autocomplete: typing suggestions only. Its output is never stored; the selected
 * suggestion is verified by the tenant's verifying provider before it reaches the registry.
 */
export function createGeoapifyAutocomplete(
  id: string,
  settings: GeoapifySettings,
  fetchImpl: typeof fetch = fetch,
): AddressProvider {
  return {
    id,
    async suggest(query, { signal }) {
      const response = await fetchImpl(geoapifyRequest(settings, query), {
        signal: AbortSignal.any([signal, AbortSignal.timeout(settings.timeoutMs ?? 3000)]),
        headers: { accept: "application/json" },
      });

      if (!response.ok) throw new Error(`Geoapify returned ${response.status}`);

      const { results } = resultsSchema.parse(await response.json());

      return results.flatMap((r) => {
        const line1 = r.housenumber && r.street ? `${r.housenumber} ${r.street}` : r.address_line1;

        if (!line1 || !r.city || !r.state_code) return [];

        return [
          {
            line1,
            city: r.city,
            region: r.state_code.toUpperCase(),
            postalCode: r.postcode ?? "",
            country: (r.country_code ?? query.country).toUpperCase(),
          },
        ];
      });
    },
  };
}
