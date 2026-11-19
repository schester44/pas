import {
  type AddressInput,
  type AddressProvider,
  registryKey,
  standardizeOffline,
  textKey,
  type Verification,
} from "@pas/addressing";
import type { ClockProvider, TenantContext, UnitOfWork } from "@pas/kernel";
import { AddressRecord } from "../domain/address-record";
import { decideResolution } from "../domain/resolution";
import type { AddressProviders, FallbackGeocoder } from "../ports/address-providers";
import type { AddressRepository } from "../ports/address-repository";
import { type AddressRecordDto, toAddressValue, toRecordDto } from "./dto";

export interface ResolveDeps {
  uow: UnitOfWork;
  records: AddressRepository;
  providers: AddressProviders;
  geocoder: FallbackGeocoder;
  clocks: ClockProvider;
  timeoutMs?: number;
}

export interface ResolvedAddress {
  record: AddressRecordDto;
  value: ReturnType<typeof toAddressValue>;
  notes: string[];
}

const verifierOf = (providers: readonly AddressProvider[]) => providers.find((p) => p.verify);

async function verify(
  deps: ResolveDeps,
  ctx: TenantContext,
  input: AddressInput,
): Promise<Verification> {
  const verifier = verifierOf(await deps.providers.for(ctx));

  if (!verifier?.verify) return standardizeOffline(input);

  try {
    return await verifier.verify(input, { signal: AbortSignal.timeout(deps.timeoutMs ?? 5000) });
  } catch {
    return {
      ...standardizeOffline(input, verifier.id),
      notes: ["Verification is unavailable right now"],
    };
  }
}

/**
 * Returns the tenant's registry record for an address, creating it on first sight (PLAN §15.9).
 * A value already stamped with a record id whose text still matches is trusted without a lookup.
 */
export function makeResolveAddress(deps: ResolveDeps) {
  return async function resolveAddress(
    ctx: TenantContext,
    input: AddressInput & { addressId?: string },
  ): Promise<ResolvedAddress> {
    const clock = deps.clocks.forTenant(ctx.tenantId);

    if (input.addressId) {
      const stamped = await deps.uow.run(ctx, (tx) =>
        deps.records.findById(tx, ctx, input.addressId!),
      );

      if (stamped && stamped.toSnapshot().textKey === textKey(input)) {
        return { record: toRecordDto(stamped), value: toAddressValue(stamped, input), notes: [] };
      }
    }

    const verification = await verify(deps, ctx, input);

    const record = await deps.uow.run(ctx, async (tx) => {
      const [byKey, byText] = await Promise.all([
        deps.records.findByKey(tx, ctx, registryKey(verification)),
        deps.records.findByTextKeys(tx, ctx, [
          ...new Set([textKey(verification.address), textKey(input)]),
        ]),
      ]);

      const decision = decideResolution({ verification, byKey, byText });

      if (decision.kind === "create") {
        return deps.records.save(
          tx,
          ctx,
          AddressRecord.fromVerification(ctx.tenantId, verification, clock),
        );
      }

      decision.record.verifiedAgain(verification, clock);

      return deps.records.save(tx, ctx, decision.record);
    });

    if (!record.toSnapshot().geocode) {
      const extra = await deps.geocoder.geocode(ctx, record.toSnapshot().address).catch(() => null);

      if (extra && record.supplement(extra, clock)) {
        await deps.uow.run(ctx, (tx) => deps.records.save(tx, ctx, record));
      }
    }

    return {
      record: toRecordDto(record),
      value: toAddressValue(record, input),
      notes: verification.notes,
    };
  };
}

export type ResolveAddress = ReturnType<typeof makeResolveAddress>;
