import type { ClockProvider, TenantContext, UnitOfWork } from "@pas/kernel";
import { makeCheckClearance } from "../application/check-clearance";
import { makeKnownGeocodes } from "../application/known-geocodes";
import { makeResolveAddress } from "../application/resolve-address";
import { makeStampAddresses, makeStampDocument } from "../application/stamp-addresses";
import { makeSuggestAddresses } from "../application/suggest-addresses";
import { makeTrackAddressUsage } from "../application/track-address-usage";
import type { AddressProviders } from "../ports/address-providers";
import { CensusFallbackGeocoder } from "./census-fallback-geocoder";
import { PrismaAddressRepository } from "./prisma-address-repository";
import { PrismaAddressUsages } from "./prisma-address-usages";

/** The registry's use cases, shared by the api and worker composition roots. */
export function composeAddresses(deps: {
  uow: UnitOfWork;
  clocks: ClockProvider;
  providers: AddressProviders;
  isSandbox: (ctx: TenantContext) => Promise<boolean>;
}) {
  const records = new PrismaAddressRepository();
  const usages = new PrismaAddressUsages();

  const resolve = makeResolveAddress({
    uow: deps.uow,
    records,
    providers: deps.providers,
    geocoder: new CensusFallbackGeocoder(deps.isSandbox),
    clocks: deps.clocks,
  });

  return {
    resolve,
    suggest: makeSuggestAddresses({ providers: deps.providers }),
    stamp: makeStampAddresses({ resolve }),
    stampDocument: makeStampDocument({ resolve }),
    track: makeTrackAddressUsage({ uow: deps.uow, usages }),
    clearance: makeCheckClearance({ uow: deps.uow, usages }),
    knownGeocodes: makeKnownGeocodes({ uow: deps.uow, records }),
  };
}

export type Addresses = ReturnType<typeof composeAddresses>;
