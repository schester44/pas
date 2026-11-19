import { invalid, newId, parsePlainDate, type TenantContext } from "@pas/kernel";
import type { Business } from "../domain/commission";
import type { LicensingMode } from "../domain/license";
import type { LicensingRequirement } from "../ports/commission-repository";
import type { DistributionDeps } from "./deps";
import { type CommissionScheduleDto, toScheduleDto } from "./dto";

export interface SaveScheduleInput {
  id?: string;
  productId: string | null;
  country: string;
  subdivision: string | null;
  business: Business | null;
  tier: string | null;
  rate: string;
  effectiveDate: string;
  expirationDate: string | null;
}

/** Commission schedules and per-product licensing requirements: tenant distribution config. */
export function makeManageRules(deps: Pick<DistributionDeps, "uow" | "commissions" | "clocks">) {
  const now = (ctx: TenantContext) => deps.clocks.forTenant(ctx.tenantId).now();

  return {
    async schedules(ctx: TenantContext): Promise<CommissionScheduleDto[]> {
      const schedules = await deps.uow.run(ctx, (tx) => deps.commissions.schedules(tx, ctx));

      return schedules.map(toScheduleDto);
    },

    async saveSchedule(
      ctx: TenantContext,
      input: SaveScheduleInput,
    ): Promise<CommissionScheduleDto> {
      const rate = Number(input.rate);

      if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
        throw invalid("Enter a rate between 0 and 100 percent");
      }

      const schedule = {
        id: input.id ?? newId(),
        productId: input.productId,
        country: input.country,
        subdivision: input.subdivision,
        business: input.business,
        tier: input.tier?.trim() || null,
        rate: input.rate,
        effectiveDate: parsePlainDate(input.effectiveDate),
        expirationDate: input.expirationDate ? parsePlainDate(input.expirationDate) : null,
      };

      await deps.uow.run(ctx, (tx) => deps.commissions.saveSchedule(tx, ctx, schedule, now(ctx)));

      return toScheduleDto(schedule);
    },

    async removeSchedule(ctx: TenantContext, input: { id: string }): Promise<void> {
      await deps.uow.run(ctx, (tx) => deps.commissions.deleteSchedule(tx, ctx, input.id));
    },

    async requirements(ctx: TenantContext): Promise<LicensingRequirement[]> {
      return deps.uow.run(ctx, (tx) => deps.commissions.requirements(tx, ctx));
    },

    async saveRequirement(
      ctx: TenantContext,
      input: { productId: string; mode: LicensingMode; linesOfAuthority: string[] },
    ): Promise<LicensingRequirement> {
      const requirement = {
        productId: input.productId,
        mode: input.mode,
        linesOfAuthority: [...new Set(input.linesOfAuthority.map((l) => l.trim()).filter(Boolean))],
      };

      await deps.uow.run(ctx, (tx) =>
        deps.commissions.saveRequirement(tx, ctx, requirement, now(ctx)),
      );

      return requirement;
    },
  };
}

export type ManageRules = ReturnType<typeof makeManageRules>;
