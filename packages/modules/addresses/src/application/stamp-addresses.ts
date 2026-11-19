import type { RiskSchema } from "@pas/forms-core";
import { setAt } from "@pas/forms-core";
import type { TenantContext } from "@pas/kernel";
import { addressesIn, isAddressValue } from "../domain/address-fields";
import type { UsageRole } from "../domain/clearance";
import type { ResolveAddress } from "./resolve-address";

export interface StampedAddress {
  path: string;
  role: UsageRole;
  addressId: string;
  verified: boolean;
}

/**
 * Resolves every address field in validated risk data to its registry record and writes the
 * record id (and the standardized address, when verified) back into the data.
 */
export function makeStampAddresses(deps: { resolve: ResolveAddress }) {
  return async function stampAddresses<T extends Record<string, unknown>>(
    ctx: TenantContext,
    schema: RiskSchema,
    data: T,
  ): Promise<{ data: T; addresses: StampedAddress[] }> {
    const found = addressesIn(schema, data);
    const resolved = await Promise.all(found.map((entry) => deps.resolve(ctx, entry.value)));
    let stamped = data;

    for (const [i, entry] of found.entries())
      stamped = setAt(stamped, entry.path, resolved[i]!.value);

    return {
      data: stamped,
      addresses: found.map((entry, i) => ({
        path: entry.path,
        role: entry.role,
        addressId: resolved[i]!.record.id,
        verified: resolved[i]!.record.status === "verified",
      })),
    };
  };
}

export type StampAddresses = ReturnType<typeof makeStampAddresses>;

const complete = (value: unknown) =>
  isAddressValue(value) && Boolean(value.line1.trim() && value.city.trim() && value.region.trim());

/** Stamps every complete address-shaped value in a document that has no schema (party changes). */
export function makeStampDocument(deps: { resolve: ResolveAddress }) {
  async function walk(ctx: TenantContext, value: unknown): Promise<unknown> {
    if (complete(value))
      return (await deps.resolve(ctx, value as Parameters<ResolveAddress>[1])).value;

    if (Array.isArray(value)) return Promise.all(value.map((item) => walk(ctx, item)));

    if (typeof value !== "object" || value === null) return value;

    const entries = await Promise.all(
      Object.entries(value).map(async ([key, child]) => [key, await walk(ctx, child)] as const),
    );

    return Object.fromEntries(entries);
  }

  return <T>(ctx: TenantContext, value: T): Promise<T> => walk(ctx, value) as Promise<T>;
}

export type StampDocument = ReturnType<typeof makeStampDocument>;
