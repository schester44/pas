import type { ObligationKind } from "@pas/decisions-engine";
import type { TenantContext } from "@pas/kernel";
import type { ObligationView } from "../ports/obligation-repository";
import type { ComplianceDeps } from "./deps";
import { type ObligationState, type ObligationSummaryDto, toSummaryDto } from "./dto";

export interface ComplianceBreakdown {
  key: string;
  label: string;
  due: number;
  overdue: number;
  rejected: number;
  submitted: number;
}

export interface ComplianceOverviewDto {
  counts: Record<ObligationState, number>;
  dueSoon: number;
  byState: ComplianceBreakdown[];
  byLicensee: ComplianceBreakdown[];
  byKind: ComplianceBreakdown[];
}

const SOON_DAYS = 7;

export function makeListObligations(deps: Pick<ComplianceDeps, "uow" | "obligations" | "clocks">) {
  return {
    async list(
      ctx: TenantContext,
      input: {
        view?: ObligationView;
        kind?: ObligationKind;
        jurisdiction?: string;
        licenseeId?: string;
        policyId?: string;
        limit?: number;
      },
    ): Promise<ObligationSummaryDto[]> {
      const now = deps.clocks.forTenant(ctx.tenantId).now();

      const found = await deps.uow.run(ctx, (tx) =>
        deps.obligations.list(tx, ctx, { ...input, limit: input.limit ?? 200, now }),
      );

      return found.map((o) => toSummaryDto(o, now));
    },

    /** The dashboard's counts: what's due, overdue and rejected, by state, licensee and kind. */
    async overview(ctx: TenantContext): Promise<ComplianceOverviewDto> {
      const clock = deps.clocks.forTenant(ctx.tenantId);
      const now = clock.now();
      const soon = now.add({ hours: 24 * SOON_DAYS });

      const all = await deps.uow.run(ctx, (tx) =>
        deps.obligations.list(tx, ctx, { view: "all", limit: 5000, now }),
      );

      const dtos = all.map((o) => toSummaryDto(o, now));

      const counts: Record<ObligationState, number> = {
        due: 0,
        overdue: 0,
        rejected: 0,
        submitted: 0,
        done: 0,
        waived: 0,
      };

      for (const o of dtos) counts[o.state]++;

      const group = (key: (o: ObligationSummaryDto) => [string, string]) => {
        const groups = new Map<string, ComplianceBreakdown>();

        for (const o of dtos) {
          if (o.state === "done" || o.state === "waived") continue;

          const [k, label] = key(o);

          const entry = groups.get(k) ?? {
            key: k,
            label,
            due: 0,
            overdue: 0,
            rejected: 0,
            submitted: 0,
          };

          entry[o.state]++;
          groups.set(k, entry);
        }

        return [...groups.values()].toSorted(
          (a, b) => b.overdue - a.overdue || b.due - a.due || a.label.localeCompare(b.label),
        );
      };

      return {
        counts,
        dueSoon: dtos.filter(
          (o) =>
            o.state === "due" &&
            Temporal.Instant.compare(Temporal.Instant.from(o.lateFrom), soon) <= 0,
        ).length,
        byState: group((o) => [o.jurisdiction, o.jurisdiction]),
        byLicensee: group((o) => [o.responsible.licenseeId ?? "tenant", o.responsible.name]),
        byKind: group((o) => [o.kind, o.kind]),
      };
    },
  };
}

export type ListObligations = ReturnType<typeof makeListObligations>;
