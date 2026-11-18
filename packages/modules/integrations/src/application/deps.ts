import type { ClockProvider, Outbox, TenantContext, UnitOfWork } from "@pas/kernel";
import { notFound } from "@pas/kernel";
import type { InstallRepository } from "../ports/install-repository";
import type { IntegrationEvents } from "../ports/integration-events";
import type { AnyProviderPackage, ProviderCatalog } from "../ports/provider-catalog";
import type { SecretBox } from "../ports/secret-box";
import type { ProviderResolver } from "./provider-resolver";

export interface IntegrationDeps {
  uow: UnitOfWork;
  outbox: Outbox;
  installs: InstallRepository;
  events: IntegrationEvents;
  catalog: ProviderCatalog;
  secrets: SecretBox;
  resolver: ProviderResolver;
  clocks: ClockProvider;
}

export function packageOf(deps: IntegrationDeps, providerId: string): AnyProviderPackage {
  const pkg = deps.catalog.get(providerId);

  if (!pkg) throw notFound("Integration", providerId);

  return pkg;
}

export const clockOf = (deps: IntegrationDeps, ctx: TenantContext) =>
  deps.clocks.forTenant(ctx.tenantId);
