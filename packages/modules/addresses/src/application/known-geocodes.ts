import type { KnownResult } from "@pas/enrichment";
import type { RiskSchema } from "@pas/forms-core";
import type { TenantContext, UnitOfWork } from "@pas/kernel";
import { addressesIn } from "../domain/address-fields";
import type { AddressRepository } from "../ports/address-repository";

/**
 * Registry coordinates and FIPS as enrichment answers: rooftop-verified records skip the geocode
 * call; coarser ones only fill in when the geocoding providers fail.
 */
export function makeKnownGeocodes(deps: { uow: UnitOfWork; records: AddressRepository }) {
  return async function knownGeocodes(
    ctx: TenantContext,
    schema: RiskSchema,
    data: Readonly<Record<string, unknown>>,
  ): Promise<KnownResult[]> {
    const stamped = addressesIn(schema, data).filter((a) => a.value.addressId);
    const ids = stamped.map((a) => a.value.addressId!);
    const records = await deps.uow.run(ctx, (tx) => deps.records.findByIds(tx, ctx, ids));
    const byId = new Map(records.map((r) => [r.id as string, r]));

    return stamped.flatMap(({ path, value }) => {
      const record = byId.get(value.addressId!);
      const r = record?.toSnapshot();

      if (!record || !r?.geocode) return [];

      return [
        {
          capability: "geocode" as const,
          path,
          providerId: `address_registry:${r.provider}`,
          authoritative: record.rooftop,
          response: {
            matched: true,
            latitude: r.geocode.latitude,
            longitude: r.geocode.longitude,
            precision: r.geocode.precision,
            stateCode: r.address.region,
            stateFips: r.address.county?.fips.slice(0, 2),
            countyFips: r.address.county?.fips,
            countyName: r.address.county?.name,
          },
        },
      ];
    });
  };
}

export type KnownGeocodes = ReturnType<typeof makeKnownGeocodes>;
