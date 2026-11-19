import type { TenantContext } from "@pas/kernel";
import { primaryAgencyOf } from "../domain/producer";
import type { DistributionDeps } from "./deps";

export interface ProducerOfRecord {
  producerId: string | null;
  name: string | null;
  agencyId: string | null;
  agencyName: string | null;
}

/**
 * The producer and agency a submission or policy is written through: the given agency when the
 * producer belongs to it, else their primary agency.
 */
export function makeProducerOfRecord(
  deps: Pick<DistributionDeps, "uow" | "agencies" | "producers">,
) {
  return async function producerOfRecord(
    ctx: TenantContext,
    input: { userId: string; agencyId?: string | null },
  ): Promise<ProducerOfRecord> {
    return deps.uow.run(ctx, async (tx) => {
      const producer = await deps.producers.findByUser(tx, ctx, input.userId);

      const agencyId =
        producer?.memberships.find((m) => m.agencyId === input.agencyId)?.agencyId ??
        (producer ? primaryAgencyOf(producer) : null);

      const agency = agencyId ? await deps.agencies.findById(tx, ctx, agencyId) : null;

      return {
        producerId: producer?.id ?? null,
        name: producer?.name ?? null,
        agencyId: agency?.id ?? null,
        agencyName: agency?.name ?? null,
      };
    });
  };
}

export type ProducerOfRecordLookup = ReturnType<typeof makeProducerOfRecord>;
