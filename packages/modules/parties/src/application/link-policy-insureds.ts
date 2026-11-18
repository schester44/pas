import type { Outbox, TenantContext, Transaction, ClockProvider } from "@pas/kernel";
import { ClientAccount } from "../domain/client-account";
import { contactKeys, type InsuredContact } from "../domain/contact";
import { matchClientAccount } from "../domain/matching";
import type { ClientAccountRepository } from "../ports/client-account-repository";
import type { PolicyPartyRepository } from "../ports/policy-party-repository";

/**
 * At bind, inside the issuing transaction: match or open a client account per named insured,
 * link it to the policy, and invite the first named insured to the portal.
 */
export function makeLinkPolicyInsureds(deps: {
  accounts: ClientAccountRepository;
  parties: PolicyPartyRepository;
  outbox: Outbox;
  clocks: ClockProvider;
}) {
  return async function linkPolicyInsureds(
    tx: Transaction,
    ctx: TenantContext,
    input: { policyId: string; policyNumber: string; insureds: InsuredContact[] },
  ): Promise<{ clientAccountIds: string[] }> {
    const linked = await deps.parties.listByPolicy(tx, ctx, input.policyId);

    if (linked.length > 0) return { clientAccountIds: linked.map((l) => l.clientAccountId) };

    const ids: string[] = [];

    for (const [index, insured] of input.insureds.entries()) {
      if (!insured.name.trim()) continue;

      const candidates = await deps.accounts.findCandidates(tx, ctx, contactKeys(insured));

      const match = matchClientAccount(
        contactKeys(insured),
        candidates.map((c) => c.keys()),
      );

      const existing = match && candidates.find((c) => c.id === match.accountId);

      const account =
        existing ?? ClientAccount.open(ctx.tenantId, insured, deps.clocks.forTenant(ctx.tenantId));

      if (existing) existing.absorb(insured, deps.clocks.forTenant(ctx.tenantId));

      const role = index === 0 ? "named_insured" : "additional_named_insured";

      if (role === "named_insured" && account.primaryEmail) {
        account.invite(
          { id: input.policyId, number: input.policyNumber },
          deps.clocks.forTenant(ctx.tenantId),
        );
      }

      await deps.accounts.save(tx, account);
      await deps.outbox.add(tx, account.pullEvents());

      await deps.parties.link(tx, ctx, {
        policyId: input.policyId,
        policyNumber: input.policyNumber,
        clientAccountId: account.id,
        role,
      });

      ids.push(account.id);
    }

    return { clientAccountIds: ids };
  };
}

export type LinkPolicyInsureds = ReturnType<typeof makeLinkPolicyInsureds>;
