import type { Clock, TenantContext, Transaction, UnitOfWork } from "@pas/kernel";
import { type ClientScope, clientScopeFor } from "../domain/client-scope";
import { emailKey } from "../domain/contact";
import type { ClientAccountRepository } from "../ports/client-account-repository";
import type { ClientUserRepository } from "../ports/client-user-repository";
import type { PolicyPartyRepository } from "../ports/policy-party-repository";

export interface ClientIdentity {
  userId: string;
  email: string;
  emailVerified: boolean;
}

type Deps = {
  accounts: ClientAccountRepository;
  parties: PolicyPartyRepository;
  users: ClientUserRepository;
  clock: Clock;
};

export async function loadClientScope(
  deps: Deps,
  tx: Transaction,
  ctx: TenantContext,
  userId: string,
): Promise<ClientScope> {
  const clientUsers = await deps.users.listForUser(tx, ctx, userId);
  const accountIds = clientUsers.map((u) => u.clientAccountId);

  const [accounts, links] = await Promise.all([
    deps.accounts.findByIds(tx, ctx, accountIds),
    deps.parties.listByAccounts(tx, ctx, accountIds),
  ]);

  return clientScopeFor({
    tenantId: ctx.tenantId,
    userId,
    clientUsers: clientUsers.map((u) => ({ ...u, tenantId: ctx.tenantId })),
    accounts: accounts.map((a) => ({ id: a.id, tenantId: ctx.tenantId, status: a.status })),
    links: links.map((l) => ({ ...l, tenantId: ctx.tenantId })),
  });
}

/**
 * The client's scope in this tenant. A verified sign-in email that matches a client account's
 * email on file links that account first, so an invited insured lands on their policies.
 */
export function makeResolveClientScope(deps: Deps & { uow: UnitOfWork }) {
  return async function resolveClientScope(
    ctx: TenantContext,
    identity: ClientIdentity,
  ): Promise<ClientScope> {
    return deps.uow.run(ctx, async (tx) => {
      const key = emailKey(identity.email);

      if (identity.emailVerified && key) {
        const linked = new Set(
          (await deps.users.listForUser(tx, ctx, identity.userId)).map((u) => u.clientAccountId),
        );

        const matches = await deps.accounts.findByEmailKey(tx, ctx, key);

        for (const account of matches.filter((a) => !linked.has(a.id))) {
          account.verifyEmail(identity.email, deps.clock);
          await deps.accounts.save(tx, account);

          await deps.users.link(tx, ctx, {
            userId: identity.userId,
            clientAccountId: account.id,
            method: "email",
            verifiedAt: deps.clock.now(),
          });
        }
      }

      return loadClientScope(deps, tx, ctx, identity.userId);
    });
  };
}

export type ResolveClientScope = ReturnType<typeof makeResolveClientScope>;
