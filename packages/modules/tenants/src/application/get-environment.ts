import type { ClockProvider, TenantContext, UnitOfWork } from "@pas/kernel";
import type { TenantEnvironmentRepository } from "../ports/tenant-environment-repository";

export interface EnvironmentDto {
  kind: "production" | "sandbox";
  parent: { tenantId: string; name: string } | null;
  sandboxes: { tenantId: string; name: string; slug: string; createdAt: string }[];
  now: string;
  clockOffsetMs: number;
}

export function makeGetEnvironment(deps: {
  uow: UnitOfWork;
  environments: TenantEnvironmentRepository;
  clocks: ClockProvider;
}) {
  return async function getEnvironment(ctx: TenantContext): Promise<EnvironmentDto> {
    return deps.uow.run(ctx, async (tx) => {
      const environment = (await deps.environments.find(tx, ctx))?.toSnapshot();
      const now = deps.clocks.forTenant(ctx.tenantId).now().toString();

      if (environment?.kind === "sandbox" && environment.parentTenantId) {
        const parent = await deps.environments.organization(tx, environment.parentTenantId);

        return {
          kind: "sandbox",
          parent: parent && { tenantId: parent.id, name: parent.name },
          sandboxes: [],
          now,
          clockOffsetMs: environment.clockOffsetMs,
        };
      }

      const sandboxes = await deps.environments.sandboxes(tx, ctx);

      return {
        kind: "production",
        parent: null,
        sandboxes: sandboxes.map((s) => ({
          tenantId: s.id,
          name: s.name,
          slug: s.slug,
          createdAt: s.createdAt.toString(),
        })),
        now,
        clockOffsetMs: 0,
      };
    });
  };
}

export type GetEnvironment = ReturnType<typeof makeGetEnvironment>;
