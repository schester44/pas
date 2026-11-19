import { z } from "zod";
import type {
  AddressInput,
  AddressProvider,
  AddressSuggestion,
  DpvMatch,
  GeocodePrecision,
  SuggestQuery,
  Verification,
} from "./address";
import { standardizeOffline } from "./offline";

export interface SmartySettings {
  authId: string;
  authToken: string;
  /** US Street `match`: strict returns only USPS-deliverable addresses. */
  match?: "strict" | "enhanced" | "invalid";
  /** Uses the US Rooftop Geocoding licence when the subscription has it. */
  rooftop?: boolean;
  autocompleteUrl?: string;
  streetUrl?: string;
  timeoutMs?: number;
}

const AUTOCOMPLETE = "https://us-autocomplete-pro.api.smarty.com/lookup";
const STREET = "https://us-street.api.smarty.com/street-address";

const suggestionsSchema = z.object({
  suggestions: z
    .array(
      z.object({
        street_line: z.string(),
        secondary: z.string().default(""),
        city: z.string(),
        state: z.string(),
        zipcode: z.string(),
        entries: z.number().default(0),
      }),
    )
    .nullish(),
});

const candidateSchema = z.object({
  smarty_key: z.string().optional(),
  delivery_line_1: z.string(),
  delivery_point_barcode: z.string().optional(),
  components: z.looseObject({
    primary_number: z.string().optional(),
    street_predirection: z.string().optional(),
    street_name: z.string().optional(),
    street_suffix: z.string().optional(),
    street_postdirection: z.string().optional(),
    secondary_designator: z.string().optional(),
    secondary_number: z.string().optional(),
    city_name: z.string().optional(),
    state_abbreviation: z.string().optional(),
    zipcode: z.string().optional(),
    plus4_code: z.string().optional(),
  }),
  metadata: z.looseObject({
    county_fips: z.string().optional(),
    county_name: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    precision: z.string().optional(),
  }),
  analysis: z.looseObject({
    dpv_match_code: z.string().optional(),
    dpv_vacant: z.string().optional(),
    dpv_no_stat: z.string().optional(),
    footnotes: z.string().optional(),
  }),
});

const secrets = (settings: SmartySettings) => ({
  "auth-id": settings.authId,
  "auth-token": settings.authToken,
});

/** Smarty's `selected` token expands a multi-unit suggestion into its units. */
export const smartySelected = (s: {
  street_line: string;
  secondary: string;
  entries: number;
  city: string;
  state: string;
  zipcode: string;
}) =>
  [s.street_line, s.secondary, `(${s.entries})`, s.city, s.state, s.zipcode]
    .filter(Boolean)
    .join(" ");

export function smartyAutocompleteRequest(settings: SmartySettings, query: SuggestQuery): URL {
  const url = new URL(settings.autocompleteUrl ?? AUTOCOMPLETE);

  url.search = new URLSearchParams({
    ...secrets(settings),
    search: query.text,
    max_results: String(query.limit),
    ...(query.selected && { selected: query.selected }),
  }).toString();

  return url;
}

export function smartyStreetRequest(settings: SmartySettings, input: AddressInput): URL {
  const url = new URL(settings.streetUrl ?? STREET);

  url.search = new URLSearchParams({
    ...secrets(settings),
    street: input.line1,
    ...(input.line2?.trim() && { secondary: input.line2.trim() }),
    city: input.city,
    state: input.region,
    zipcode: input.postalCode,
    candidates: "1",
    match: settings.match ?? "strict",
    ...(settings.rooftop && { license: "us-rooftop-geocoding-cloud" }),
  }).toString();

  return url;
}

const PRECISION: Record<string, GeocodePrecision> = {
  Rooftop: "rooftop",
  Parcel: "parcel",
  Zip9: "zip9",
  Zip8: "zip9",
  Zip7: "zip7",
  Zip6: "zip7",
  Zip5: "zip5",
  Street: "street",
};

const VALID: ReadonlySet<string> = new Set(["Y", "S", "D"]);

export function fromSmartyCandidate(
  provider: string,
  input: AddressInput,
  raw: unknown,
): Verification {
  const candidate = candidateSchema.parse(raw);
  const c = candidate.components;
  const m = candidate.metadata;
  const dpv = (candidate.analysis.dpv_match_code || null) as DpvMatch | null;
  const verified = dpv !== null && VALID.has(dpv);

  const street = [
    c.primary_number,
    c.street_predirection,
    c.street_name,
    c.street_suffix,
    c.street_postdirection,
  ]
    .filter(Boolean)
    .join(" ");

  const unit = [c.secondary_designator, c.secondary_number].filter(Boolean).join(" ");
  const id = candidate.smarty_key ?? candidate.delivery_point_barcode ?? null;

  return {
    status: verified ? "verified" : "unverified",
    provider,
    providerAddressId: verified ? id : null,
    address: {
      line1: c.street_name ? street : candidate.delivery_line_1,
      ...(unit && { line2: unit }),
      city: c.city_name ?? input.city,
      region: c.state_abbreviation ?? input.region,
      postalCode: c.zipcode ?? input.postalCode,
      ...(c.plus4_code && { plus4: c.plus4_code }),
      country: "US",
      components: {
        ...(c.primary_number && { primaryNumber: c.primary_number }),
        ...(c.street_predirection && { streetPredirection: c.street_predirection }),
        ...(c.street_name && { streetName: c.street_name }),
        ...(c.street_suffix && { streetSuffix: c.street_suffix }),
        ...(c.street_postdirection && { streetPostdirection: c.street_postdirection }),
        ...(c.secondary_designator && { secondaryDesignator: c.secondary_designator }),
        ...(c.secondary_number && { secondaryNumber: c.secondary_number }),
      },
      ...(m.county_fips &&
        m.county_name && { county: { name: m.county_name, fips: m.county_fips } }),
    },
    dpv: {
      match: dpv,
      vacant: candidate.analysis.dpv_vacant ? candidate.analysis.dpv_vacant === "Y" : null,
      deliverable: dpv ? verified && candidate.analysis.dpv_no_stat !== "Y" : null,
    },
    geocode:
      m.latitude !== undefined && m.longitude !== undefined
        ? {
            latitude: m.latitude,
            longitude: m.longitude,
            precision: PRECISION[m.precision ?? ""] ?? "unknown",
            source: provider,
          }
        : null,
    notes: dpv === "D" ? ["Add the apartment or unit number"] : [],
  };
}

/** Smarty US Autocomplete Pro for suggestions and US Street API for verification (vendors.md §1). */
export function createSmartyAddressProvider(
  id: string,
  settings: SmartySettings,
  fetchImpl: typeof fetch = fetch,
): AddressProvider {
  const get = async (url: URL, signal: AbortSignal) => {
    const response = await fetchImpl(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(settings.timeoutMs ?? 4000)]),
      headers: { accept: "application/json" },
    });

    if (!response.ok) throw new Error(`Smarty returned ${response.status}`);

    return response.json() as Promise<unknown>;
  };

  return {
    id,
    async suggest(query, { signal }) {
      const body = suggestionsSchema.parse(
        await get(smartyAutocompleteRequest(settings, query), signal),
      );

      return (body.suggestions ?? []).map((s): AddressSuggestion => ({
        line1: s.street_line,
        ...(s.secondary && s.entries <= 1 && { line2: s.secondary }),
        city: s.city,
        region: s.state,
        postalCode: s.zipcode,
        country: "US",
        ...(s.entries > 1 && { entries: s.entries, selected: smartySelected(s) }),
      }));
    },
    async verify(input, { signal }) {
      const candidates = z
        .array(z.unknown())
        .parse(await get(smartyStreetRequest(settings, input), signal));

      const [first] = candidates;

      if (first === undefined)
        return { ...standardizeOffline(input, id), notes: ["No match for this address"] };

      return fromSmartyCandidate(id, input, first);
    },
  };
}
