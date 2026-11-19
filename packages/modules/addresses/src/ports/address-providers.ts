import type { AddressInput, AddressProvider, Geocode } from "@pas/addressing";
import type { ProviderFor, TenantContext } from "@pas/kernel";

/** The tenant's enabled address providers in order; empty when none is enabled. */
export type AddressProviders = ProviderFor<readonly AddressProvider[]>;

/** A keyless geocoder for addresses the provider left without coordinates (US Census). */
export interface FallbackGeocoder {
  geocode(
    ctx: TenantContext,
    address: AddressInput,
  ): Promise<{ geocode: Geocode; county?: { name: string; fips: string } } | null>;
}
