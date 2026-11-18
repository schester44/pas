import {
  asId,
  DomainError,
  newId,
  type Outbox,
  type TenantContext,
  type UnitOfWork,
  type ClockProvider,
} from "@pas/kernel";
import { claimAttemptsLeft, claimWindowStart, postalCodeMatches } from "../domain/claim";
import type { ClientScope } from "../domain/client-scope";
import type { ClientAccountRepository } from "../ports/client-account-repository";
import type { ClientUserRepository } from "../ports/client-user-repository";
import type { PolicyPartyRepository } from "../ports/policy-party-repository";
import { type ClientIdentity, loadClientScope } from "./resolve-client-scope";

export type ClaimResult =
  | { status: "linked"; scope: ClientScope }
  | { status: "no_match"; attemptsLeft: number };

/**
 * Self-claim (PLAN §7.7): a signed-in client proves they hold a policy with its number and the
 * named insured's mailing ZIP. Wrong answers are rate-limited per user.
 */
export function makeClaimClientPolicy(deps: {
  uow: UnitOfWork;
  outbox: Outbox;
  accounts: ClientAccountRepository;
  parties: PolicyPartyRepository;
  users: ClientUserRepository;
  clocks: ClockProvider;
}) {
  return async function claimClientPolicy(
    ctx: TenantContext,
    identity: ClientIdentity,
    input: { policyNumber: string; postalCode: string },
  ): Promise<ClaimResult> {
    const policyNumber = input.policyNumber.trim().toUpperCase();

    const outcome = await deps.uow.run(ctx, async (tx) => {
      const now = deps.clocks.forTenant(ctx.tenantId).now();

      const failures = await deps.users.countFailedClaims(
        tx,
        ctx,
        identity.userId,
        claimWindowStart(now),
      );

      if (claimAttemptsLeft(failures) === 0) return { status: "locked" as const };

      const links = await deps.parties.findByPolicyNumber(tx, ctx, policyNumber);
      const named = links.find((l) => l.role === "named_insured");
      const account = named && (await deps.accounts.findById(tx, ctx, asId(named.clientAccountId)));

      const matched =
        !!account &&
        account.status === "active" &&
        postalCodeMatches(account.toSnapshot().mailingAddress, input.postalCode);

      await deps.users.recordClaimAttempt(tx, ctx, {
        userId: identity.userId,
        policyNumber,
        succeeded: matched,
        attemptedAt: now,
      });

      if (!matched || !account) {
        return { status: "no_match" as const, attemptsLeft: claimAttemptsLeft(failures + 1) };
      }

      if (identity.emailVerified)
        account.verifyEmail(identity.email, deps.clocks.forTenant(ctx.tenantId));

      await deps.accounts.save(tx, account);

      await deps.users.link(tx, ctx, {
        userId: identity.userId,
        clientAccountId: account.id,
        method: "self_claim",
        verifiedAt: now,
      });

      await deps.outbox.add(tx, [
        {
          id: newId(),
          type: "parties.client_claimed",
          tenantId: ctx.tenantId,
          aggregateType: "client_account",
          aggregateId: account.id,
          occurredAt: now,
          payload: { userId: identity.userId, policyNumber },
        },
      ]);

      return {
        status: "linked" as const,
        scope: await loadClientScope(deps, tx, ctx, identity.userId),
      };
    });

    if (outcome.status === "locked") {
      throw new DomainError("precondition_failed", "Too many attempts. Try again in an hour.", {
        reason: "claim_rate_limited",
      });
    }

    return outcome;
  };
}

export type ClaimClientPolicy = ReturnType<typeof makeClaimClientPolicy>;
