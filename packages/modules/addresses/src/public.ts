export type { AddressRecordId, AddressStatus } from "./domain/address-record";
export {
  CLEARANCE_MODES,
  clearanceModeFrom,
  type ClearanceMode,
  type SubjectKind,
  type SubjectRef,
  type UsageRole,
} from "./domain/clearance";
export { addressesIn, addressIdsIn, addressFieldsOf } from "./domain/address-fields";
export type { AddressRecordDto, ClearanceDto } from "./application/dto";
export type { AddressProviders, FallbackGeocoder } from "./ports/address-providers";
export type { AddressRepository } from "./ports/address-repository";
export type { AddressUsages } from "./ports/address-usages";
export {
  makeResolveAddress,
  type ResolveAddress,
  type ResolveDeps,
  type ResolvedAddress,
} from "./application/resolve-address";
export { makeSuggestAddresses, type SuggestAddresses } from "./application/suggest-addresses";
export {
  makeStampDocument,
  type StampDocument,
  makeStampAddresses,
  type StampAddresses,
  type StampedAddress,
} from "./application/stamp-addresses";
export {
  makeTrackAddressUsage,
  type TrackAddressUsage,
  type TrackUsageInput,
} from "./application/track-address-usage";
export { makeCheckClearance, type CheckClearance } from "./application/check-clearance";
export { makeKnownGeocodes, type KnownGeocodes } from "./application/known-geocodes";
