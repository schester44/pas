import type { TenantContext, UnitOfWork } from "@pas/kernel";
import { type ClearanceMode, decideClearance, type SubjectRef } from "../domain/clearance";
import type { AddressUsages } from "../ports/address-usages";
import { type ClearanceDto, toClearanceDto } from "./dto";

/** Possible duplicate risks for a subject's locations (PLAN §15.9); not a BOR workflow. */
export function makeCheckClearance(deps: { uow: UnitOfWork; usages: AddressUsages }) {
  return async function checkClearance(
    ctx: TenantContext,
    input: {
      mode: ClearanceMode;
      subject: SubjectRef;
      related?: readonly SubjectRef[];
      producerId: string | null;
      /** The locations to check; defaults to the subject's tracked location usages. */
      addressIds?: readonly string[];
    },
  ): Promise<ClearanceDto> {
    if (input.mode === "off") return { mode: "off", outcome: "clear", conflicts: [] };

    const usages = await deps.uow.run(ctx, async (tx) => {
      const ids =
        input.addressIds ??
        (await deps.usages.listBySubject(tx, ctx, input.subject))
          .filter((u) => u.role === "location")
          .map((u) => u.addressId);

      return { ids, usages: await deps.usages.listActiveByAddresses(tx, ctx, ids) };
    });

    return toClearanceDto(
      decideClearance({ ...input, addressIds: usages.ids, usages: usages.usages }),
    );
  };
}

export type CheckClearance = ReturnType<typeof makeCheckClearance>;
