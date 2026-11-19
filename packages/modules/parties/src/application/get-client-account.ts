import { notFound, type TenantContext, type UnitOfWork } from "@pas/kernel";
import type { ClientAccountId } from "../domain/client-account";
import type { ClientAccountRepository } from "../ports/client-account-repository";
import type { ClientUserRepository } from "../ports/client-user-repository";
import type { PolicyPartyRepository } from "../ports/policy-party-repository";
import type { ClientAccountSummaryDto } from "./search-client-accounts";
import { toClientAccountDto } from "./dto";

export interface ClientAccountDetailDto extends ClientAccountSummaryDto {
  portal: { method: string; verifiedAt: string }[];
}

/** One client account for staff: profile, linked policies and portal access. */
export function makeGetClientAccount(deps: {
  uow: UnitOfWork;
  accounts: ClientAccountRepository;
  parties: PolicyPartyRepository;
  users: ClientUserRepository;
}) {
  return async function getClientAccount(
    ctx: TenantContext,
    input: { id: string },
  ): Promise<ClientAccountDetailDto> {
    return deps.uow.run(ctx, async (tx) => {
      const account = await deps.accounts.findById(tx, ctx, input.id as ClientAccountId);

      if (!account) throw notFound("Client", input.id);

      const [links, users] = await Promise.all([
        deps.parties.listByAccounts(tx, ctx, [account.id]),
        deps.users.listForAccounts(tx, ctx, [account.id]),
      ]);

      return {
        ...toClientAccountDto(account),
        policies: links.map((l) => ({ id: l.policyId, number: l.policyNumber, role: l.role })),
        portalUsers: users.length,
        portal: users.map((u) => ({ method: u.method, verifiedAt: u.verifiedAt.toString() })),
      };
    });
  };
}

export type GetClientAccount = ReturnType<typeof makeGetClientAccount>;
