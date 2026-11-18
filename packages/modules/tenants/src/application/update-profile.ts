import {
  conflict,
  type Outbox,
  type TenantContext,
  type UnitOfWork,
  type ClockProvider,
} from "@pas/kernel";
import type { AppHosts } from "../domain/hosts";
import { TenantProfile, type TenantProfileChanges } from "../domain/tenant-profile";
import type { TenantDirectory } from "../ports/tenant-directory";
import type { TenantProfileRepository } from "../ports/tenant-profile-repository";
import { type TenantProfileDto, toTenantProfileDto } from "./dto";

export type UpdateProfileInput = TenantProfileChanges;

export function makeUpdateProfile(deps: {
  uow: UnitOfWork;
  outbox: Outbox;
  profiles: TenantProfileRepository;
  directory: TenantDirectory;
  hosts: AppHosts;
  clocks: ClockProvider;
}) {
  return async function updateProfile(
    ctx: TenantContext,
    input: UpdateProfileInput,
  ): Promise<TenantProfileDto> {
    return deps.uow.run(ctx, async (tx) => {
      const profile =
        (await deps.profiles.find(tx, ctx)) ??
        TenantProfile.initial(await deps.profiles.organization(tx, ctx));

      profile.update(input, deps.clocks.forTenant(ctx.tenantId));
      const next = profile.toSnapshot();

      // Pre-checked only for a precise message; the unique indexes are the real guarantee.
      const bySubdomain = await deps.directory.findBySubdomain(next.appSubdomain);

      if (bySubdomain && bySubdomain.organization.id !== ctx.tenantId) {
        throw conflict(`${next.appSubdomain} is already in use. Choose another subdomain.`, {
          field: "appSubdomain",
        });
      }

      for (const hostname of next.customDomains) {
        const owner = await deps.directory.findByCustomDomain(hostname);

        if (owner && owner.organization.id !== ctx.tenantId) {
          throw conflict(`${hostname} is already connected to another organization.`, {
            field: "customDomains",
          });
        }
      }

      await deps.profiles.save(tx, profile);
      await deps.outbox.add(tx, profile.pullEvents());

      return toTenantProfileDto(profile, deps.hosts);
    });
  };
}

export type UpdateProfile = ReturnType<typeof makeUpdateProfile>;
