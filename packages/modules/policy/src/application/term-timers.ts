import {
  asId,
  type Clock,
  type ClockProvider,
  coverageInstant,
  type Jurisdiction,
  jurisdictionTimeZone,
  type Outbox,
  type TenantContext,
  type UnitOfWork,
} from "@pas/kernel";
import type { InvoiceIssuer } from "../ports/invoice-issuer";
import type { PolicyRepository } from "../ports/policy-repository";
import { billIssued } from "./pricing";

const msUntil = (clock: Clock, date: Temporal.PlainDate, jurisdiction: Jurisdiction) =>
  Math.max(
    0,
    clock
      .now()
      .until(coverageInstant(date, jurisdictionTimeZone(jurisdiction)))
      .total("milliseconds"),
  );

const localToday = (clock: Clock, jurisdiction: Jurisdiction) =>
  clock.today(jurisdictionTimeZone(jurisdiction));

/** What the term workflows read and do on their date timers (PLAN §7.3). */
export function makeTermTimers(deps: {
  uow: UnitOfWork;
  outbox: Outbox;
  policies: PolicyRepository;
  invoices: InvoiceIssuer;
  clocks: ClockProvider;
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
      const term = (await load(ctx, input.termId)).term(input.termId);

      return msUntil(deps.clocks.forTenant(ctx.tenantId), term.effectiveDate, term.jurisdiction);
    },
    async describe(ctx: TenantContext, input: { termId: string }) {
      const policy = await deps.uow.run(ctx, (tx) =>
        deps.policies.findByTerm(tx, ctx, asId(input.termId)),
      );

      return policy && { policyId: policy.id, number: policy.number };
    },
    async activate(ctx: TenantContext, input: { termId: string }): Promise<string> {
      return deps.uow.run(ctx, async (tx) => {
        const policy = await deps.policies.findByTerm(tx, ctx, asId(input.termId));

        if (!policy) throw new Error(`Term ${input.termId} is gone`);

        const clock = deps.clocks.forTenant(ctx.tenantId);
        const today = localToday(clock, policy.term(input.termId).jurisdiction);

        if (policy.activateTerm(asId(input.termId), today, clock)) {
          await deps.policies.save(tx, policy);
          await deps.outbox.add(tx, policy.pullEvents());
        }

        return policy.term(input.termId).status;
      });
    },
    /** Null once the cancellation is no longer scheduled (rescinded or already issued). */
    async msUntilCancellation(
      ctx: TenantContext,
      input: { termId: string; transactionId: string },
    ) {
      const policy = await load(ctx, input.termId);
      const transaction = policy.transaction(input.transactionId);

      return transaction.status === "scheduled"
        ? msUntil(
            deps.clocks.forTenant(ctx.tenantId),
            transaction.effectiveDate,
            policy.term(input.termId).jurisdiction,
          )
        : null;
    },
    /** Issues the scheduled cancellation on its date; a no-op if it was rescinded. */
    async effectCancellation(ctx: TenantContext, input: { termId: string; transactionId: string }) {
      return deps.uow.run(ctx, async (tx) => {
        const policy = await deps.policies.findByTerm(tx, ctx, asId(input.termId));

        if (!policy) throw new Error(`Term ${input.termId} is gone`);

        const transaction = policy.transaction(input.transactionId);
        const clock = deps.clocks.forTenant(ctx.tenantId);
        const today = localToday(clock, policy.term(input.termId).jurisdiction);

        if (
          transaction.status !== "scheduled" ||
          Temporal.PlainDate.compare(today, transaction.effectiveDate) < 0
        ) {
          return transaction.status;
        }

        const delivery = transaction.details?.cancellation?.delivery ?? "electronic";

        if (delivery !== "electronic" && !policy.hasProofOfMailing(transaction.id)) {
          if (policy.holdCancellation(transaction.id, clock)) {
            await deps.policies.save(tx, policy);
            await deps.outbox.add(tx, policy.pullEvents());
          }

          return "held";
        }

        const charges = policy.issueTransaction(transaction.id, today, clock);
        const actor = { type: "system" as const, name: "Cancellation timer" };

        await billIssued(deps, tx, ctx, policy, transaction.id, charges, actor);
        await deps.policies.save(tx, policy);
        await deps.outbox.add(tx, policy.pullEvents());

        return "issued";
      });
    },
  };
}

export type TermTimers = ReturnType<typeof makeTermTimers>;
