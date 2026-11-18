import type { TenantContext, UnitOfWork } from "@pas/kernel";
import type { ClientAccountRepository } from "../ports/client-account-repository";
import type { ClientUserRepository } from "../ports/client-user-repository";
import type { PolicyPartyRepository } from "../ports/policy-party-repository";
import { type ClientAccountDto, toClientAccountDto } from "./dto";

export interface ClientAccountSummaryDto extends ClientAccountDto {
  policies: { id: string; number: string; role: string }[];
  portalUsers: number;
}

export function makeSearchClientAccounts(deps: {
  uow: UnitOfWork;
  accounts: ClientAccountRepository;
  parties: PolicyPartyRepository;
  users: ClientUserRepository;
}) {
  return async function searchClientAccounts(
    ctx: TenantContext,
    input: { query?: string; limit?: number },
  ): Promise<ClientAccountSummaryDto[]> {
    return deps.uow.run(ctx, async (tx) => {
      const accounts = await deps.accounts.search(tx, ctx, {
        query: input.query?.trim() ?? "",
        limit: Math.min(Math.max(input.limit ?? 50, 1), 200),
      });

      const ids = accounts.map((a) => a.id);

      const [links, users] = await Promise.all([
        deps.parties.listByAccounts(tx, ctx, ids),
        deps.users.listForAccounts(tx, ctx, ids),
      ]);

      return accounts.map((account) => ({
        ...toClientAccountDto(account),
        policies: links
          .filter((l) => l.clientAccountId === account.id)
          .map((l) => ({ id: l.policyId, number: l.policyNumber, role: l.role })),
        portalUsers: users.filter((u) => u.clientAccountId === account.id).length,
      }));
    });
  };
}

export type SearchClientAccounts = ReturnType<typeof makeSearchClientAccounts>;
