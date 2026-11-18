import type { TenantContext, UnitOfWork } from "@pas/kernel";
import type { ClientAccountRepository } from "../ports/client-account-repository";
import type { ClientUserRepository } from "../ports/client-user-repository";
import type { PolicyPartyRepository } from "../ports/policy-party-repository";
import { type ClientAccountDto, toClientAccountDto } from "./dto";

export interface PolicyClientDto extends ClientAccountDto {
  role: string;
  portalUsers: number;
}

/** The client accounts on a policy. Callers check policy access first. */
export function makeGetPolicyClients(deps: {
  uow: UnitOfWork;
  accounts: ClientAccountRepository;
  parties: PolicyPartyRepository;
  users: ClientUserRepository;
}) {
  return async function getPolicyClients(
    ctx: TenantContext,
    input: { policyId: string },
  ): Promise<PolicyClientDto[]> {
    return deps.uow.run(ctx, async (tx) => {
      const links = await deps.parties.listByPolicy(tx, ctx, input.policyId);
      const ids = links.map((l) => l.clientAccountId);

      const [accounts, users] = await Promise.all([
        deps.accounts.findByIds(tx, ctx, ids),
        deps.users.listForAccounts(tx, ctx, ids),
      ]);

      return links.flatMap((link) => {
        const account = accounts.find((a) => a.id === link.clientAccountId);

        if (!account) return [];

        return [
          {
            ...toClientAccountDto(account),
            role: link.role,
            portalUsers: users.filter((u) => u.clientAccountId === account.id).length,
          },
        ];
      });
    });
  };
}

export type GetPolicyClients = ReturnType<typeof makeGetPolicyClients>;
