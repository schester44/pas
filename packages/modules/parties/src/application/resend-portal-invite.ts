import {
  asId,
  notFound,
  type Outbox,
  type TenantContext,
  type UnitOfWork,
  type ClockProvider,
} from "@pas/kernel";
import type { ClientAccountRepository } from "../ports/client-account-repository";
import type { PolicyPartyRepository } from "../ports/policy-party-repository";

export function makeResendPortalInvite(deps: {
  uow: UnitOfWork;
  outbox: Outbox;
  accounts: ClientAccountRepository;
  parties: PolicyPartyRepository;
  clocks: ClockProvider;
}) {
  return async function resendPortalInvite(
    ctx: TenantContext,
    input: { policyId: string; clientAccountId: string },
  ): Promise<{ email: string }> {
    return deps.uow.run(ctx, async (tx) => {
      const links = await deps.parties.listByPolicy(tx, ctx, input.policyId);
      const link = links.find((l) => l.clientAccountId === input.clientAccountId);

      if (!link) throw notFound("Client on policy", input.clientAccountId);

      const account = await deps.accounts.findById(tx, ctx, asId(input.clientAccountId));

      if (!account) throw notFound("Client account", input.clientAccountId);

      account.invite(
        { id: link.policyId, number: link.policyNumber },
        deps.clocks.forTenant(ctx.tenantId),
        true,
      );

      await deps.accounts.save(tx, account);
      await deps.outbox.add(tx, account.pullEvents());

      return { email: account.primaryEmail! };
    });
  };
}

export type ResendPortalInvite = ReturnType<typeof makeResendPortalInvite>;
