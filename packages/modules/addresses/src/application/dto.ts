import type { AddressInput, Geocode, Verification } from "@pas/addressing";
import type { AddressValue } from "@pas/forms-core";
import type { AddressRecord } from "../domain/address-record";
import type { AddressUsage, Clearance } from "../domain/clearance";

export interface AddressRecordDto {
  id: string;
  status: "verified" | "unverified";
  provider: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string;
  postalCode: string;
  plus4: string | null;
  country: string;
  county: { name: string; fips: string } | null;
  geocode: Geocode | null;
  dpv: Verification["dpv"];
  verifiedAt: string | null;
}

export function toRecordDto(record: AddressRecord): AddressRecordDto {
  const r = record.toSnapshot();

  return {
    id: r.id,
    status: r.status,
    provider: r.provider,
    line1: r.address.line1,
    line2: r.address.line2 ?? null,
    city: r.address.city,
    region: r.address.region,
    postalCode: r.address.postalCode,
    plus4: r.address.plus4 ?? null,
    country: r.address.country,
    county: r.address.county ?? null,
    geocode: r.geocode,
    dpv: r.dpv,
    verifiedAt: r.verifiedAt?.toString() ?? null,
  };
}

/** Verified records replace what was typed with the standardized address; unverified keep it. */
export function toAddressValue(record: AddressRecord, entered: AddressInput): AddressValue {
  const r = record.toSnapshot();

  const source = record.verified
    ? { ...r.address, line2: r.address.line2 }
    : { ...entered, line2: entered.line2?.trim() || undefined };

  return {
    line1: source.line1,
    ...(source.line2 && { line2: source.line2 }),
    city: source.city,
    region: source.region,
    postalCode: source.postalCode,
    country: source.country,
    addressId: r.id,
    verified: record.verified,
  };
}

export interface ClearanceDto {
  mode: Clearance["mode"];
  outcome: Clearance["outcome"];
  conflicts: {
    addressId: string;
    subjectKind: AddressUsage["subject"]["kind"];
    subjectId: string;
    label: string;
    producerName: string | null;
  }[];
}

export function toClearanceDto(clearance: Clearance): ClearanceDto {
  return {
    mode: clearance.mode,
    outcome: clearance.outcome,
    conflicts: clearance.conflicts.map((c) => ({
      addressId: c.addressId,
      subjectKind: c.subject.kind,
      subjectId: c.subject.id,
      label: c.label,
      producerName: c.producer?.name ?? null,
    })),
  };
}
