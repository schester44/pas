import type { AddressInput } from "@pas/addressing";
import { createCensusGeocoder } from "@pas/enrichment";
import type { TenantContext } from "@pas/kernel";
import type { FallbackGeocoder } from "../ports/address-providers";

/** The free US Census geocoder for records without coordinates. Skipped in sandboxes (rule 10). */
export class CensusFallbackGeocoder implements FallbackGeocoder {
  private readonly census = createCensusGeocoder({ timeoutMs: 3000, retries: 0 });

  constructor(private readonly isSandbox: (ctx: TenantContext) => Promise<boolean>) {}

  async geocode(ctx: TenantContext, address: AddressInput) {
    if (address.country !== "US" || (await this.isSandbox(ctx))) return null;

    const result = await this.census.fetch(
      "geocode",
      {
        street: [address.line1, address.line2].filter(Boolean).join(" "),
        city: address.city,
        state: address.region,
        postalCode: address.postalCode,
      },
      { signal: AbortSignal.timeout(3500) },
    );

    if (
      !result.matched ||
      typeof result.latitude !== "number" ||
      typeof result.longitude !== "number"
    )
      return null;

    const fips = typeof result.countyFips === "string" ? result.countyFips : undefined;

    const name =
      typeof result.countyName === "string" ? result.countyName.replace(/ County$/, "") : undefined;

    return {
      geocode: {
        latitude: result.latitude,
        longitude: result.longitude,
        precision: "street" as const,
        source: "census_geocoder",
      },
      ...(fips && name && { county: { name, fips } }),
    };
  }
}
