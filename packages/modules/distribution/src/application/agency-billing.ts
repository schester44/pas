import { Money, notFound, type TenantContext } from "@pas/kernel";
import { mayAgencyBill, type RemittanceBasis } from "../domain/agency";
import type { DistributionDeps } from "./deps";

type MoneyDto = { amount: string; currency: string };

/** What billing needs to bill through an agency (PLAN §13). */
export interface AgencyBillingTerms {
  agencyId: string;
  name: string;
  address: unknown;
  mayAgencyBill: boolean;
  eligible: boolean;
  suspension: { at: string; reason: string } | null;
  remittanceDays: number;
  creditLimit: MoneyDto | null;
  remittanceBasis: RemittanceBasis;
  statementDay: number | null;
  reminderDays: number | null;
  suspendAfterDays: number | null;
  nonpaymentCancels: boolean;
  /** The agency's email and its admins', where statements and aging notices go. */
  contacts: string[];
}

/**
 * Agency-bill terms, the suspension of the privilege when a statement ages, and the commission
 * recorded on transactions, read by billing through the composition roots.
 */
export function makeAgencyBilling(
  deps: Pick<DistributionDeps, "uow" | "agencies" | "producers" | "commissions" | "clocks">,
) {
  return {
    async terms(ctx: TenantContext, input: { agencyId: string }): Promise<AgencyBillingTerms> {
      return deps.uow.run(ctx, async (tx) => {
        const agency = await deps.agencies.findById(tx, ctx, input.agencyId);

        if (!agency) throw notFound("Agency", input.agencyId);

        const producers = await deps.producers.list(tx, ctx, {});

        const admins = producers
          .filter(
            (p) =>
              p.status === "active" &&
              p.memberships.some((m) => m.agencyId === agency.id && m.role === "admin"),
          )
          .map((p) => p.email);

        const b = agency.billing;

        return {
          agencyId: agency.id,
          name: agency.name,
          address: agency.address,
          mayAgencyBill: mayAgencyBill(agency),
          eligible: b.eligible,
          suspension: b.suspension && {
            at: b.suspension.at.toString(),
            reason: b.suspension.reason,
          },
          remittanceDays: b.remittanceDays ?? 0,
          creditLimit: b.creditLimit?.toJSON() ?? null,
          remittanceBasis: b.remittanceBasis,
          statementDay: b.statementDay,
          reminderDays: b.reminderDays,
          suspendAfterDays: b.suspendAfterDays,
          nonpaymentCancels: b.nonpaymentCancels,
          contacts: [...new Set([...(agency.email ? [agency.email] : []), ...admins])],
        };
      });
    },

    /** Suspends agency bill (new binds fall back to direct bill); false when already suspended. */
    async suspend(ctx: TenantContext, input: { agencyId: string; reason: string }) {
      return deps.uow.run(ctx, async (tx) => {
        const agency = await deps.agencies.findById(tx, ctx, input.agencyId);

        if (!agency) throw notFound("Agency", input.agencyId);

        if (agency.billing.suspension) return false;

        const now = deps.clocks.forTenant(ctx.tenantId).now();

        await deps.agencies.save(tx, {
          ...agency,
          billing: { ...agency.billing, suspension: { at: now, reason: input.reason } },
          updatedAt: now,
        });

        return true;
      });
    },

    async restore(ctx: TenantContext, input: { agencyId: string }) {
      return deps.uow.run(ctx, async (tx) => {
        const agency = await deps.agencies.findById(tx, ctx, input.agencyId);

        if (!agency?.billing.suspension) return false;

        const now = deps.clocks.forTenant(ctx.tenantId).now();

        await deps.agencies.save(tx, {
          ...agency,
          billing: { ...agency.billing, suspension: null },
          updatedAt: now,
        });

        return true;
      });
    },

    /** Commission recorded per policy transaction, summed across its coverage lines. */
    async commissions(
      ctx: TenantContext,
      input: { transactionIds: readonly string[] },
    ): Promise<Record<string, MoneyDto>> {
      if (input.transactionIds.length === 0) return {};

      const rows = await deps.uow.run(ctx, (tx) =>
        deps.commissions.list(tx, ctx, { transactionIds: input.transactionIds }),
      );

      const totals = new Map<string, Money>();

      for (const row of rows) {
        const sum = totals.get(row.transactionId) ?? Money.zero(row.amount.currency);

        totals.set(row.transactionId, sum.plus(row.amount));
      }

      return Object.fromEntries([...totals].map(([id, amount]) => [id, amount.toJSON()]));
    },
  };
}

export type AgencyBilling = ReturnType<typeof makeAgencyBilling>;
