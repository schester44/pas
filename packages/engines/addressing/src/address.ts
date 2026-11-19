export interface AddressInput {
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}

export type GeocodePrecision =
  | "rooftop"
  | "parcel"
  | "street"
  | "zip9"
  | "zip7"
  | "zip5"
  | "unknown";

export interface Geocode {
  latitude: number;
  longitude: number;
  precision: GeocodePrecision;
  /** Which provider produced it: rooftop geocodes carry licence terms (vendors.md §1). */
  source: string;
}

export interface AddressComponents {
  primaryNumber?: string;
  streetPredirection?: string;
  streetName?: string;
  streetSuffix?: string;
  streetPostdirection?: string;
  secondaryDesignator?: string;
  secondaryNumber?: string;
}

/** USPS-standardized: `line1` is the delivery line without the unit, `line2` the unit. */
export interface StandardizedAddress {
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode: string;
  plus4?: string;
  country: string;
  components: AddressComponents;
  county?: { name: string; fips: string };
}

export type DpvMatch = "Y" | "S" | "D" | "N";

export interface Verification {
  status: "verified" | "unverified";
  provider: string;
  /** The provider's stable delivery-point id (SmartyKey); null when nothing matched. */
  providerAddressId: string | null;
  address: StandardizedAddress;
  dpv: { match: DpvMatch | null; vacant: boolean | null; deliverable: boolean | null };
  geocode: Geocode | null;
  notes: string[];
}

export interface AddressSuggestion {
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  /** More than one: a building whose units are listed by suggesting again with `selected`. */
  entries?: number;
  /** Opaque, provider-specific token to expand a building into its units. */
  selected?: string;
}

export interface SuggestQuery {
  text: string;
  selected?: string;
  country: string;
  limit: number;
}

/**
 * The port behind addresses (PLAN §15.9). Autocomplete and verification are separate legs, so a
 * cheaper suggestion-only provider can sit in front of the verifier; only verified output is stored.
 */
export interface AddressProvider {
  readonly id: string;
  suggest?(query: SuggestQuery, options: { signal: AbortSignal }): Promise<AddressSuggestion[]>;
  verify?(input: AddressInput, options: { signal: AbortSignal }): Promise<Verification>;
}
