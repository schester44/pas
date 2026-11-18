import { asId, type Clock, type Outbox, type TenantContext, type UnitOfWork } from "@pas/kernel";
import type { PolicyRepository } from "../ports/policy-repository";

/** What the term workflow reads and does on its effective-date timer. */
export function makeTermTimers(deps: {
  uow: UnitOfWork;
  outbox: Outbox;
  policies: PolicyRepository;
  clock: Clock;
}) {
  async function load(ctx: TenantContext, termId: string) {
    return deps.uow.run(ctx, async (tx) => {
      const policy = await deps.policies.findByTerm(tx, ctx, asId(termId));

      if (!policy) throw new Error(`Term ${termId} is gone`);

      return policy;
    });
  }

  return {
    async msUntilEffective(ctx: TenantContext, input: { termId: string }): Promise<number> {
      const policy = await load(ctx, input.termId);
      const term = policy.toSnapshot().terms.find((t) => t.id === input.termId)!;
      const starts = term.effectiveDate.toZonedDateTime({ timeZone: "UTC" }).toInstant();

      return Math.max(0, deps.clock.now().until(starts).total("milliseconds"));
    },
    async activate(ctx: TenantContext, input: { termId: string }): Promise<string> {
      return deps.uow.run(ctx, async (tx) => {
        const policy = await deps.policies.findByTerm(tx, ctx, asId(input.termId));

        if (!policy) throw new Error(`Term ${input.termId} is gone`);

        if (policy.activateTerm(asId(input.termId), deps.clock.today("UTC"), deps.clock)) {
          await deps.policies.save(tx, policy);
          await deps.outbox.add(tx, policy.pullEvents());
        }

        return policy.toSnapshot().terms.find((t) => t.id === input.termId)!.status;
      });
    },
  };
}

export type TermTimers = ReturnType<typeof makeTermTimers>;
