import type {
  CheckClearance,
  ResolveAddress,
  StampAddresses,
  TrackAddressUsage,
} from "@pas/addresses";

/** The tenant's address registry (PLAN §15.9): canonical records, usages and clearance. */
export interface AddressRegistry {
  resolve: ResolveAddress;
  stamp: StampAddresses;
  track: TrackAddressUsage;
  clearance: CheckClearance;
}
