import {
  type Geocode,
  registryKey,
  type StandardizedAddress,
  textKey,
  type Verification,
} from "@pas/addressing";
import { type Clock, type Id, type Instant, newId, type TenantId } from "@pas/kernel";

export type AddressRecordId = Id<"AddressRecord">;

export type AddressStatus = Verification["status"];

export interface AddressRecordProps {
  id: AddressRecordId;
  tenantId: TenantId;
  key: string;
  textKey: string;
  provider: string;
  providerAddressId: string | null;
  status: AddressStatus;
  address: StandardizedAddress;
  geocode: Geocode | null;
  dpv: Verification["dpv"];
  verifiedAt: Instant | null;
  createdAt: Instant;
  updatedAt: Instant;
}

/** One canonical address in a tenant's registry (PLAN §15.9). */
export class AddressRecord {
  private constructor(private props: AddressRecordProps) {}

  static fromVerification(
    tenantId: TenantId,
    verification: Verification,
    clock: Clock,
  ): AddressRecord {
    const now = clock.now();

    return new AddressRecord({
      id: newId(),
      tenantId,
      key: registryKey(verification),
      textKey: textKey(verification.address),
      provider: verification.provider,
      providerAddressId: verification.providerAddressId,
      status: verification.status,
      address: verification.address,
      geocode: verification.geocode,
      dpv: verification.dpv,
      verifiedAt: verification.status === "verified" ? now : null,
      createdAt: now,
      updatedAt: now,
    });
  }

  static restore(props: AddressRecordProps): AddressRecord {
    return new AddressRecord(props);
  }

  get id(): AddressRecordId {
    return this.props.id;
  }

  get key(): string {
    return this.props.key;
  }

  get verified(): boolean {
    return this.props.status === "verified";
  }

  get rooftop(): boolean {
    return this.verified && this.props.geocode?.precision === "rooftop";
  }

  /** A verification of the same address: keeps the id, takes the provider's latest answer. */
  verifiedAgain(verification: Verification, clock: Clock): void {
    if (verification.status !== "verified") return;

    const now = clock.now();

    this.props = {
      ...this.props,
      key: registryKey(verification),
      textKey: textKey(verification.address),
      provider: verification.provider,
      providerAddressId: verification.providerAddressId,
      status: "verified",
      address: verification.address,
      geocode: verification.geocode ?? this.props.geocode,
      dpv: verification.dpv,
      verifiedAt: now,
      updatedAt: now,
    };
  }

  /** Fills a missing geocode or county from a fallback source; never replaces a better one. */
  supplement(
    extra: { geocode: Geocode | null; county?: { name: string; fips: string } },
    clock: Clock,
  ): boolean {
    const geocode = this.props.geocode ?? extra.geocode;
    const county = this.props.address.county ?? extra.county;

    if (geocode === this.props.geocode && county === this.props.address.county) return false;

    this.props = {
      ...this.props,
      geocode,
      address: { ...this.props.address, ...(county && { county }) },
      updatedAt: clock.now(),
    };

    return true;
  }

  toSnapshot(): Readonly<AddressRecordProps> {
    return this.props;
  }
}
