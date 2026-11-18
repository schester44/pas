import { allowsSeveral } from "../domain/category";
import { invalid, newId, type TenantContext } from "@pas/kernel";
import { notInstalled } from "./configure-integration";
import { clockOf, type IntegrationDeps, packageOf } from "./deps";
import { rulesOf } from "./rules";

/** Enables or disables an install. Enabling one provider for a single-provider port switches the port to it. */
export function makeSetIntegrationStatus(deps: IntegrationDeps) {
  return async function setIntegrationStatus(
    ctx: TenantContext,
    input: { providerId: string; enabled: boolean },
  ): Promise<void> {
    const { manifest } = packageOf(deps, input.providerId);

    if (manifest.builtin) throw invalid("Built-in providers are always available");

    const sandbox = await deps.resolver.isSandbox(ctx.tenantId);
    const clock = clockOf(deps, ctx);

    await deps.uow.run(ctx, async (tx) => {
      const install = await deps.installs.find(tx, ctx, manifest.id);

      if (!install) throw notInstalled();

      const changed = [install];

      if (input.enabled) {
        install.enable(rulesOf(manifest), sandbox, clock);

        if (!allowsSeveral(manifest.category)) {
          const others = (await deps.installs.list(tx, ctx)).filter(
            (other) =>
              other.category === manifest.category && other.id !== install.id && other.active,
          );

          for (const other of others) other.disable(clock);

          changed.push(...others);
        }
      } else {
        install.disable(clock);
      }

      for (const each of changed) {
        const events = each.pullEvents();

        if (events.length === 0) continue;

        await deps.installs.save(tx, each);
        await deps.outbox.add(tx, events);

        await deps.events.add(tx, ctx, {
          id: newId(),
          installId: each.id,
          providerId: each.providerId,
          kind: "status",
          outcome: "ok",
          summary: each.active
            ? "Enabled"
            : each === install
              ? "Disabled"
              : `Disabled; ${manifest.name} took over`,
          externalId: null,
          data: { by: ctx.actor },
          occurredAt: clock.now(),
        });
      }
    });

    deps.resolver.invalidate(ctx.tenantId);
  };
}

export type SetIntegrationStatus = ReturnType<typeof makeSetIntegrationStatus>;
