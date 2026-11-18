import { newId, type TenantContext } from "@pas/kernel";
import { notInstalled } from "./configure-integration";
import { clockOf, type IntegrationDeps, packageOf } from "./deps";

const TIMEOUT_MS = 10_000;

export interface HealthCheckDto {
  ok: boolean;
  detail: string;
  checkedAt: string;
}

/** "Test connection": calls the provider with the saved settings and records the outcome. */
export function makeTestIntegration(deps: IntegrationDeps) {
  return async function testIntegration(
    ctx: TenantContext,
    input: { providerId: string },
  ): Promise<HealthCheckDto> {
    const pkg = packageOf(deps, input.providerId);
    const clock = clockOf(deps, ctx);

    if (pkg.manifest.builtin) {
      return { ok: true, detail: "Built in; always available", checkedAt: clock.now().toString() };
    }

    const install = await deps.uow.run(ctx, (tx) => deps.installs.find(tx, ctx, pkg.manifest.id));

    if (!install) throw notInstalled();

    const result = await withTimeout(pkg.check(deps.resolver.settings(install.toSnapshot()))).catch(
      (error: unknown) => ({ ok: false, detail: (error as Error).message }),
    );

    await deps.uow.run(ctx, async (tx) => {
      const current = (await deps.installs.find(tx, ctx, pkg.manifest.id))!;
      current.recordHealth(result.ok, result.detail, clock);
      await deps.installs.save(tx, current);

      await deps.events.add(tx, ctx, {
        id: newId(),
        installId: current.id,
        providerId: current.providerId,
        kind: "health_check",
        outcome: result.ok ? "ok" : "error",
        summary: result.ok
          ? `Connection OK: ${result.detail}`
          : `Connection failed: ${result.detail}`,
        externalId: null,
        data: { environment: current.toSnapshot().environment },
        occurredAt: clock.now(),
      });
    });

    deps.resolver.invalidate(ctx.tenantId);

    return { ...result, checkedAt: clock.now().toString() };
  };
}

function withTimeout<T>(work: Promise<T>): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error("The provider didn't answer in 10 seconds")),
        TIMEOUT_MS,
      ).unref();
    }),
  ]);
}

export type TestIntegration = ReturnType<typeof makeTestIntegration>;
