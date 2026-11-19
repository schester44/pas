import type { Verification } from "@pas/addressing";
import type { AddressRecord } from "./address-record";

export type Resolution =
  | { kind: "reuse"; record: AddressRecord }
  | { kind: "upgrade"; record: AddressRecord }
  | { kind: "create" };

/**
 * Dedupe: an exact registry key wins. Otherwise a record with the same normalized text stands in,
 * so a verified answer upgrades an earlier unverified record and an unverified entry of a known
 * verified address lands on that record instead of creating a twin.
 */
export function decideResolution(input: {
  verification: Verification;
  byKey: AddressRecord | null;
  byText: readonly AddressRecord[];
}): Resolution {
  if (input.byKey) return { kind: "reuse", record: input.byKey };

  if (input.verification.status === "verified") {
    const unverified = input.byText.find((record) => !record.verified);

    return unverified ? { kind: "upgrade", record: unverified } : { kind: "create" };
  }

  const known = input.byText.find((record) => record.verified) ?? input.byText[0];

  return known ? { kind: "reuse", record: known } : { kind: "create" };
}
