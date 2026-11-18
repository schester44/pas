import {
  type ClockProvider,
  DomainError,
  newId,
  type ProviderFor,
  type TenantContext,
  type TenantId,
  type UnitOfWork,
} from "@pas/kernel";
import type { IntegrationCategory } from "../domain/category";
import type { InstallProps } from "../domain/install";
import { type Selected, selectProviders } from "../domain/selection";
import type { ProviderRegistry } from "@pas/enrichment";
import type { AdapterCategory, CategoryAdapters } from "../ports/adapters";
import type { InstallRepository } from "../ports/install-repository";
import type { IntegrationEvents } from "../ports/integration-events";
import type { ProviderCatalog, ProviderSettings } from "../ports/provider-catalog";
import type { SecretBox } from "../ports/secret-box";
import type { TenantEnvironments } from "../ports/tenant-environments";
import { rulesOf, secretContext } from "./rules";

export interface ResolverDeps {
  uow: UnitOfWork;
  installs: InstallRepository;
  events: IntegrationEvents;
  catalog: ProviderCatalog;
  secrets: SecretBox;
  environments: TenantEnvironments;
  webhookUrl: (install: { id: string; providerId: string }) => string | null;
  clocks: ClockProvider;
  /** Monotonic milliseconds for cache expiry; another process's install changes show up within `ttlMs`. */
  ticks: () => number;
  ttlMs?: number;
}

interface TenantProviders {
  loadedAt: number;
  sandbox: boolean;
  installs: Readonly<InstallProps>[];
  adapters: Map<string, unknown>;
}

export interface ResolvedProvider<C extends AdapterCategory> extends Selected {
  adapter: CategoryAdapters[C];
}

const NO_PROVIDER: Record<string, string> = {
  sms: "No SMS provider is enabled",
  filing: "No filing channel is enabled",
  carrier: "No carrier connection is enabled",
  billing: "No billing provider is enabled",
  llm: "No language model provider is enabled",
};

/**
 * Returns the adapter that powers a port for a tenant at call time (PLAN §19 decision 13).
 * Cached per tenant and dropped on install changes; sandboxes only ever get test-mode providers.
 */
export class ProviderResolver {
  private readonly cache = new Map<string, Promise<TenantProviders>>();

  constructor(private readonly deps: ResolverDeps) {}

  port<C extends AdapterCategory>(category: C): ProviderFor<CategoryAdapters[C]> {
    return { for: async (ctx) => (await this.primary(ctx, category)).adapter };
  }

  /**
   * The tenant's data providers for enrichment plans: every enabled one, by id. In a sandbox any
   * provider a plan names is answered by the built-in fake, so plans run unchanged.
   */
  readonly dataProviders: ProviderFor<ProviderRegistry> = {
    for: async (ctx) => {
      const chain = await this.chain(ctx, "data");
      const sandbox = await this.isSandbox(ctx.tenantId);
      const byId = new Map(chain.map((p) => [p.providerId, p.adapter]));
      const fake = chain.find((p) => p.installId === null)?.adapter;
      const manifests = chain.map((p) => p.adapter.manifest);

      return {
        get: (id) => byId.get(id) ?? (sandbox ? fake : undefined),
        list: () => manifests,
        withCapability: (capability) =>
          manifests.filter((m) => m.capabilities.includes(capability)),
      };
    },
  };

  async primary<C extends AdapterCategory>(
    ctx: TenantContext,
    category: C,
  ): Promise<ResolvedProvider<C>> {
    const [first] = await this.chain(ctx, category);

    if (!first) {
      throw new DomainError(
        "precondition_failed",
        NO_PROVIDER[category] ?? `No ${category} provider`,
      );
    }

    return first;
  }

  async chain<C extends AdapterCategory>(
    ctx: TenantContext,
    category: C,
  ): Promise<ResolvedProvider<C>[]> {
    const tenant = await this.load(ctx.tenantId);

    return this.selected(tenant, category).map((selected) => ({
      ...selected,
      adapter: this.adapter(ctx, tenant, selected) as CategoryAdapters[C],
    }));
  }

  /** Which provider powers each category, for the catalog's "Active" marks. */
  async powering(ctx: TenantContext): Promise<Map<IntegrationCategory, Selected[]>> {
    const tenant = await this.load(ctx.tenantId);
    const categories = new Set(this.deps.catalog.list().map((p) => p.manifest.category));

    return new Map([...categories].map((c) => [c, this.selected(tenant, c)]));
  }

  async isSandbox(tenantId: TenantId): Promise<boolean> {
    return (await this.load(tenantId)).sandbox;
  }

  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
  }

  settings(install: Readonly<InstallProps>): ProviderSettings {
    return {
      installId: install.id,
      tenantId: install.tenantId,
      environment: install.environment,
      config: install.config,
      secrets: Object.fromEntries(
        Object.entries(install.secrets).map(([key, sealed]) => [
          key,
          this.deps.secrets.open(sealed, secretContext(install.tenantId, install.id, key)),
        ]),
      ),
      webhookUrl: this.deps.webhookUrl(install),
    };
  }

  private selected(tenant: TenantProviders, category: IntegrationCategory): Selected[] {
    return selectProviders({
      category,
      installs: tenant.installs,
      providers: (id) => {
        const pkg = this.deps.catalog.get(id);

        return pkg && rulesOf(pkg.manifest);
      },
      fallback: this.deps.catalog.builtinFor(category),
      sandbox: tenant.sandbox,
    });
  }

  private adapter(ctx: TenantContext, tenant: TenantProviders, selected: Selected): unknown {
    const key = selected.installId ?? selected.providerId;
    const cached = tenant.adapters.get(key);

    if (cached) return cached;

    const pkg = this.deps.catalog.get(selected.providerId);

    if (!pkg) throw new Error(`Unknown provider ${selected.providerId}`);

    const install = tenant.installs.find((i) => i.id === selected.installId);

    const settings: ProviderSettings = install
      ? this.settings(install)
      : {
          installId: null,
          tenantId: ctx.tenantId,
          environment: "test",
          config: {},
          secrets: {},
          webhookUrl: null,
        };

    const created = pkg.create(settings);
    const adapter = install ? this.observed(created, install) : created;
    tenant.adapters.set(key, adapter);

    return adapter;
  }

  /** Installed adapters log failures (and email deliveries) to the install's activity. */
  private observed<T extends object>(adapter: T, install: Readonly<InstallProps>): T {
    const record = (outcome: "ok" | "error", summary: string, data: Record<string, unknown>) => {
      const ctx: TenantContext = {
        tenantId: install.tenantId,
        actor: { type: "system", process: "integrations" },
      };

      void this.deps.uow
        .run(ctx, (tx) =>
          this.deps.events.add(tx, ctx, {
            id: newId(),
            installId: install.id,
            providerId: install.providerId,
            kind: outcome === "ok" ? "delivery" : "error",
            outcome,
            summary,
            externalId: null,
            data,
            occurredAt: this.deps.clocks.forTenant(install.tenantId).now(),
          }),
        )
        .catch(() => undefined);
    };

    return new Proxy(adapter, {
      get(target, property) {
        const value = Reflect.get(target, property);

        if (typeof value !== "function") return value;

        return async (...args: unknown[]) => {
          try {
            const result = await Reflect.apply(value, target, args);

            if (install.category === "email" && property === "send") {
              const [message] = args as [{ tag?: string }];
              const messageId = (result as { messageId?: string | null } | undefined)?.messageId;
              const what = message.tag?.replaceAll("_", " ") ?? "email";
              record("ok", `Sent ${what}${messageId ? ` (${messageId})` : ""}`, { messageId });
            }

            return result;
          } catch (error) {
            record("error", `${String(property)} failed: ${(error as Error).message}`, {
              operation: String(property),
            });

            throw error;
          }
        };
      },
    });
  }

  private load(tenantId: TenantId): Promise<TenantProviders> {
    const cached = this.cache.get(tenantId);
    const ttl = this.deps.ttlMs ?? 60_000;

    if (cached) {
      return cached.then((tenant) =>
        this.deps.ticks() - tenant.loadedAt < ttl ? tenant : this.reload(tenantId),
      );
    }

    return this.reload(tenantId);
  }

  private reload(tenantId: TenantId): Promise<TenantProviders> {
    const ctx: TenantContext = { tenantId, actor: { type: "system", process: "integrations" } };

    const loading = Promise.all([
      this.deps.uow.run(ctx, (tx) => this.deps.installs.list(tx, ctx)),
      this.deps.environments.isSandbox(tenantId),
    ]).then(([installs, sandbox]) => ({
      loadedAt: this.deps.ticks(),
      sandbox,
      installs: installs.map((i) => i.toSnapshot()),
      adapters: new Map<string, unknown>(),
    }));

    this.cache.set(tenantId, loading);
    loading.catch(() => this.cache.delete(tenantId));

    return loading;
  }
}
