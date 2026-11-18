import { appTrpc, createAppClient } from "@pas/api-client";
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: false } },
});

export const TENANT_SLUG_KEY = "pas.tenant";

/** The app's tenant comes from its host (or the dev slug); proxies rewrite Host, so send it. */
export function tenantHeaders(): Record<string, string> {
  const slug = sessionStorage.getItem(TENANT_SLUG_KEY);
  const host = { "x-pas-host": window.location.host };

  return slug ? { ...host, "x-pas-tenant": slug } : host;
}

export const trpcClient = createAppClient("/trpc/app", tenantHeaders);

export const { TRPCProvider, useTRPC } = appTrpc;
