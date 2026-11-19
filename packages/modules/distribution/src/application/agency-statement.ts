import { type BookScope, notFound, parsePlainDate, type TenantContext } from "@pas/kernel";
import { withDescendants } from "../domain/agency";
import { statementTotals } from "../domain/commission";
import type { DistributionDeps } from "./deps";
import { type CommissionDto, toCommissionDto } from "./dto";
import { assertCovers } from "./manage-agencies";

type MoneyDto = { amount: string; currency: string };

export interface AgencyStatementDto {
  agency: { id: string; name: string };
  from: string;
  to: string;
  includesSubAgencies: boolean;
  entries: (CommissionDto & { agencyName: string })[];
  totals: { gross: MoneyDto; commission: MoneyDto; net: MoneyDto };
}

const startOf = (date: string) => Temporal.Instant.from(`${date}T00:00:00Z`);

/**
 * An agency's commission statement for a period (by recorded date): each premium transaction
 * with its gross premium, commission and the net due. No payouts yet.
 */
export function makeAgencyStatement(
  deps: Pick<DistributionDeps, "uow" | "agencies" | "commissions">,
) {
  return {
    async statement(
      ctx: TenantContext,
      scope: BookScope,
      input: { agencyId: string; from: string; to: string; includeSubAgencies: boolean },
    ): Promise<AgencyStatementDto> {
      assertCovers(scope, input.agencyId);

      return deps.uow.run(ctx, async (tx) => {
        const agencies = await deps.agencies.list(tx, ctx);
        const agency = agencies.find((a) => a.id === input.agencyId);

        if (!agency) throw notFound("Agency", input.agencyId);

        const agencyIds = input.includeSubAgencies
          ? withDescendants(agencies, [agency.id])
          : [agency.id];

        const rows = await deps.commissions.list(tx, ctx, {
          agencyIds,
          from: startOf(input.from),
          to: startOf(parsePlainDate(input.to).add({ days: 1 }).toString()),
        });

        const currency = rows[0]?.premium.currency ?? agency.billing.creditLimit?.currency ?? "USD";
        const totals = statementTotals(rows, currency);
        const names = new Map(agencies.map((a) => [a.id as string, a.name]));

        return {
          agency: { id: agency.id, name: agency.name },
          from: input.from,
          to: input.to,
          includesSubAgencies: input.includeSubAgencies,
          entries: rows.map((r) => ({
            ...toCommissionDto(r),
            agencyName: names.get(r.agencyId ?? "") ?? "",
          })),
          totals: {
            gross: totals.gross.toJSON(),
            commission: totals.commission.toJSON(),
            net: totals.net.toJSON(),
          },
        };
      });
    },

    async forPolicy(ctx: TenantContext, input: { policyId: string }): Promise<CommissionDto[]> {
      const rows = await deps.uow.run(ctx, (tx) =>
        deps.commissions.list(tx, ctx, { policyId: input.policyId }),
      );

      return rows.map(toCommissionDto);
    },
  };
}

export type AgencyStatement = ReturnType<typeof makeAgencyStatement>;
