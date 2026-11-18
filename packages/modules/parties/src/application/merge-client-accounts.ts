import {
  asId,
  type Clock,
  notFound,
  type Outbox,
  type TenantContext,
  type UnitOfWork,
} from "@pas/kernel";
import type { ClientAccountRepository } from "../ports/client-account-repository";
import type { ClientUserRepository } from "../ports/client-user-repository";
import type { PolicyPartyRepository } from "../ports/policy-party-repository";

/** Duplicate records from different producers become one; links and portal users move over. */
export function makeMergeClientAccounts(deps: {
  uow: UnitOfWork;
  outbox: Outbox;
  accounts: ClientAccountRepository;
  parties: PolicyPartyRepository;
  users: ClientUserRepository;
  clock: Clock;
}) {
  return async function mergeClientAccounts(
    ctx: TenantContext,
    input: { survivorId: string; mergedId: string },
  ): Promise<{ survivorId: string }> {
    return deps.uow.run(ctx, async (tx) => {
      const [survivor, merged] = await Promise.all([
        deps.accounts.findById(tx, ctx, asId(input.survivorId)),
        deps.accounts.findById(tx, ctx, asId(input.mergedId)),
      ]);

      if (!survivor) throw notFound("Client account", input.survivorId);

      if (!merged) throw notFound("Client account", input.mergedId);

      survivor.absorbMerged(merged, deps.clock);

      await deps.parties.moveAccount(tx, ctx, merged.id, survivor.id);
      await deps.users.moveAccount(tx, ctx, merged.id, survivor.id);
      await deps.accounts.save(tx, survivor);
      await deps.accounts.save(tx, merged);
      await deps.outbox.add(tx, survivor.pullEvents());

      return { survivorId: survivor.id };
    });
  };
}

export type MergeClientAccounts = ReturnType<typeof makeMergeClientAccounts>;
