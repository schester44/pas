import { brandStyle } from "@pas/ui/components/brand";
import { createContext, useContext } from "react";
import { TENANT_SLUG_KEY, trpcClient } from "./trpc";

export type ResolvedTenant = Awaited<ReturnType<typeof trpcClient.tenant.resolve.query>>;
export type TenantBranding = Extract<ResolvedTenant, { status: "tenant" }>["tenant"];

export async function resolveTenant(): Promise<ResolvedTenant> {
  const param = new URLSearchParams(window.location.search).get("tenant");

  if (param) sessionStorage.setItem(TENANT_SLUG_KEY, param);

  const slug = param ?? sessionStorage.getItem(TENANT_SLUG_KEY);

  return trpcClient.tenant.resolve.query({ host: window.location.host, slug });
}

export function applyBranding(tenant: TenantBranding | null): void {
  const root = document.documentElement;

  if (tenant) {
    for (const [name, value] of Object.entries(brandStyle(tenant.primaryColor))) {
      root.style.setProperty(name, String(value));
    }
  }

  document.title = tenant?.displayName ?? "PAS";
}

const TenantContext = createContext<TenantBranding | null>(null);

export const TenantProvider = TenantContext.Provider;

export function useTenant(): TenantBranding | null {
  return useContext(TenantContext);
}
