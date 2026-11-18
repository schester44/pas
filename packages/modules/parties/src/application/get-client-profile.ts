import type { TenantContext, UnitOfWork } from "@pas/kernel";
import type { ClientScope } from "../domain/client-scope";
import type { ClientAccountRepository } from "../ports/client-account-repository";
import { type ClientAccountDto, toClientAccountDto } from "./dto";

export function makeGetClientProfile(deps: { uow: UnitOfWork; accounts: ClientAccountRepository }) {
  return async function getClientProfile(
    ctx: TenantContext,
    scope: ClientScope,
  ): Promise<{ accounts: ClientAccountDto[]; policyCount: number }> {
    const accounts = await deps.uow.run(ctx, (tx) =>
      deps.accounts.findByIds(tx, ctx, scope.clientAccountIds),
    );

    return { accounts: accounts.map(toClientAccountDto), policyCount: scope.policyIds.length };
  };
}

export type GetClientProfile = ReturnType<typeof makeGetClientProfile>;
