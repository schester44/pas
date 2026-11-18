import {
  type ClockProvider,
  conflict,
  IdRemap,
  type Outbox,
  type TenantContext,
  type UnitOfWork,
} from "@pas/kernel";
import { subdomainFromSlug } from "../domain/hosts";
import { TenantEnvironment } from "../domain/tenant-environment";
import { TenantProfile } from "../domain/tenant-profile";
import type { SandboxOrganizations, SandboxSeed } from "../ports/sandbox";
import type { TenantEnvironmentRepository } from "../ports/tenant-environment-repository";
import type { TenantProfileRepository } from "../ports/tenant-profile-repository";

export interface CreatedSandbox {
  tenantId: string;
  name: string;
  copied: Record<string, number>;
}

/** A sandbox is its own tenant seeded with production's configuration (PLAN §15.4). */
export function makeCreateSandbox(deps: {
  uow: UnitOfWork;
  outbox: Outbox;
  environments: TenantEnvironmentRepository;
  profiles: TenantProfileRepository;
  organizations: SandboxOrganizations;
  seeds: readonly SandboxSeed[];
  clocks: ClockProvider;
}) {
  return async function createSandbox(
    ctx: TenantContext,
    input: { name: string },
  ): Promise<CreatedSandbox> {
    const production = await deps.uow.run(ctx, async (tx) => {
      if ((await deps.environments.find(tx, ctx))?.isSandbox) {
        throw conflict("A sandbox can't have sandboxes of its own.");
      }

      return deps.profiles.find(tx, ctx);
    });

    const org = await deps.organizations.create(ctx, input.name.trim());
    const sandbox: TenantContext = { tenantId: org.id, actor: ctx.actor };
    const clock = deps.clocks.forTenant(ctx.tenantId);

    await deps.uow.run(sandbox, async (tx) => {
      const environment = TenantEnvironment.sandbox(org.id, ctx.tenantId, clock);
      const profile = TenantProfile.initial(org);

      if (production) {
        const branding = production.toSnapshot();

        profile.update(
          { ...branding, appSubdomain: subdomainFromSlug(org.slug), customDomains: [] },
          clock,
        );
      }

      await deps.environments.save(tx, environment);
      await deps.profiles.save(tx, profile);
      await deps.outbox.add(tx, [...environment.pullEvents(), ...profile.pullEvents()]);
    });

    const ids = new IdRemap();
    const copied: Record<string, number> = {};

    for (const seed of deps.seeds) Object.assign(copied, await seed.copy(ctx, sandbox, ids));

    return { tenantId: org.id, name: org.name, copied };
  };
}

export type CreateSandbox = ReturnType<typeof makeCreateSandbox>;
