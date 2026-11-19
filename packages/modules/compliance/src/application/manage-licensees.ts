import type { TenantContext } from "@pas/kernel";
import { licensee } from "../domain/licensee";
import type { ComplianceDeps } from "./deps";

export interface LicenseeDto {
  id: string;
  name: string;
  licenseNumber: string;
  jurisdiction: string;
  active: boolean;
}

/** Surplus lines licensees of record, per state (a simple profile until distribution brings NIPR). */
export function makeManageLicensees(deps: Pick<ComplianceDeps, "uow" | "licensees">) {
  return {
    list: (ctx: TenantContext): Promise<LicenseeDto[]> =>
      deps.uow.run(ctx, async (tx) =>
        (await deps.licensees.list(tx, ctx)).map(
          ({ id, name, licenseNumber, jurisdiction, active }) => ({
            id,
            name,
            licenseNumber,
            jurisdiction,
            active,
          }),
        ),
      ),
    save: (ctx: TenantContext, input: Omit<LicenseeDto, "id"> & { id?: string }) =>
      deps.uow.run(ctx, async (tx) => {
        const saved = licensee({ ...input, tenantId: ctx.tenantId });

        await deps.licensees.save(tx, saved);

        return { id: saved.id };
      }),
    remove: (ctx: TenantContext, input: { id: string }) =>
      deps.uow.run(ctx, (tx) => deps.licensees.remove(tx, ctx, input.id)),
  };
}

export type ManageLicensees = ReturnType<typeof makeManageLicensees>;
