import type { TenantContext, UnitOfWork } from "@pas/kernel";
import type { AppHosts } from "../domain/hosts";
import { TenantProfile } from "../domain/tenant-profile";
import type { TenantProfileRepository } from "../ports/tenant-profile-repository";
import { type TenantProfileDto, toTenantProfileDto } from "./dto";

export function makeGetProfile(deps: {
  uow: UnitOfWork;
  profiles: TenantProfileRepository;
  hosts: AppHosts;
}) {
  return async function getProfile(ctx: TenantContext): Promise<TenantProfileDto> {
    return deps.uow.run(ctx, async (tx) => {
      const profile =
        (await deps.profiles.find(tx, ctx)) ??
        TenantProfile.initial(await deps.profiles.organization(tx, ctx));

      return toTenantProfileDto(profile, deps.hosts);
    });
  };
}

export type GetProfile = ReturnType<typeof makeGetProfile>;
