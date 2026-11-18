import { DomainError, invalid, newId, type TenantContext } from "@pas/kernel";
import type { IntegrationEnvironment } from "../domain/category";
import { IntegrationInstall } from "../domain/install";
import { clockOf, type IntegrationDeps, packageOf } from "./deps";
import { rulesOf, secretContext } from "./rules";

export interface ConfigureIntegrationInput {
  providerId: string;
  environment: IntegrationEnvironment;
  config: Record<string, unknown>;
  /** Only the secrets being set or replaced; blank ones keep their stored value. */
  secrets: Record<string, string>;
  position?: number;
}

const hintOf = (value: string) => (value.length >= 12 ? value.slice(-4) : "");

/** Saves an install's settings. Secrets are sealed here and never read back to a client. */
export function makeConfigureIntegration(deps: IntegrationDeps) {
  return async function configureIntegration(
    ctx: TenantContext,
    input: ConfigureIntegrationInput,
  ): Promise<void> {
    const { manifest } = packageOf(deps, input.providerId);

    if (manifest.builtin) throw invalid("Built-in providers have nothing to set up");

    const parsed = manifest.configSchema.safeParse(input.config);

    if (!parsed.success) {
      throw invalid("Check the highlighted settings", {
        fields: parsed.error.issues.map((issue) => issue.path.join(".")),
      });
    }

    const known = new Set(manifest.secrets.map((s) => s.key));
    const unknown = Object.keys(input.secrets).filter((key) => !known.has(key));

    if (unknown.length > 0) throw invalid("Unknown secret", { fields: unknown });

    const sandbox = await deps.resolver.isSandbox(ctx.tenantId);
    const clock = clockOf(deps, ctx);
    const rules = rulesOf(manifest);

    await deps.uow.run(ctx, async (tx) => {
      const install =
        (await deps.installs.find(tx, ctx, manifest.id)) ??
        IntegrationInstall.create(ctx.tenantId, rules, input.environment, clock);

      const secrets = Object.fromEntries(
        Object.entries(input.secrets)
          .filter(([, value]) => value.trim().length > 0)
          .map(([key, value]) => [
            key,
            {
              sealed: deps.secrets.seal(value.trim(), secretContext(ctx.tenantId, install.id, key)),
              hint: hintOf(value.trim()),
            },
          ]),
      );

      const existing = install.toSnapshot();

      // Saving re-seals kept secrets with the newest key, which is how keys rotate.
      const kept = Object.fromEntries(
        Object.entries(existing.secrets)
          .filter(([key]) => !secrets[key])
          .map(([key, sealed]) => {
            const context = secretContext(ctx.tenantId, install.id, key);

            return [
              key,
              {
                sealed: deps.secrets.seal(deps.secrets.open(sealed, context), context),
                hint: existing.secretHints[key] ?? "",
              },
            ];
          }),
      );

      install.configure(
        rules,
        {
          environment: input.environment,
          config: parsed.data as Record<string, unknown>,
          secrets: { ...kept, ...secrets },
          ...(input.position !== undefined && { position: input.position }),
        },
        sandbox,
        clock,
      );

      await deps.installs.save(tx, install);
      await deps.outbox.add(tx, install.pullEvents());

      await deps.events.add(tx, ctx, {
        id: newId(),
        installId: install.id,
        providerId: manifest.id,
        kind: "configured",
        outcome: "ok",
        summary:
          Object.keys(secrets).length > 0
            ? `Settings saved; ${Object.keys(secrets).length === 1 ? "1 secret" : `${Object.keys(secrets).length} secrets`} updated`
            : "Settings saved",
        externalId: null,
        data: { environment: input.environment, by: ctx.actor },
        occurredAt: clock.now(),
      });
    });

    deps.resolver.invalidate(ctx.tenantId);
  };
}

export type ConfigureIntegration = ReturnType<typeof makeConfigureIntegration>;

export const notInstalled = () =>
  new DomainError("precondition_failed", "Save this integration's settings first");
