import type { AgencyStatement, ManageAgencies } from "@pas/distribution";
import type { AgencySource } from "../ports/sources";

const TENANT = { kind: "tenant" } as const;

/** Distribution's agencies and commission statements behind the `AgencySource` port. */
export function distributionAgencySource(deps: {
  agencies: Pick<ManageAgencies, "list">;
  statements: Pick<AgencyStatement, "statement">;
}): AgencySource {
  return {
    async agencies(ctx) {
      const agencies = await deps.agencies.list(ctx, TENANT);

      return agencies.map((a) => ({ id: a.id, name: a.name, status: a.status }));
    },

    async statement(ctx, input) {
      const s = await deps.statements.statement(ctx, TENANT, {
        ...input,
        includeSubAgencies: false,
      });

      return {
        agencyName: s.agency.name,
        period: { from: s.from, to: s.to },
        entries: s.entries.map((e) => ({
          policyNumber: e.policyNumber,
          insuredName: e.insuredName,
          transactionType: e.transactionType,
          effectiveDate: e.effectiveDate,
          premium: e.premium,
          rate: e.rate,
          commission: e.amount,
        })),
        totals: s.totals,
      };
    },
  };
}
