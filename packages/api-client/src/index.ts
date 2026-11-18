import type { AdminRouter, AppRouter, PlatformRouter } from "@pas/api/router";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import superjson from "superjson";

export type { AdminRouter, AppRouter, PlatformRouter };
export type AdminInputs = inferRouterInputs<AdminRouter>;
export type AdminOutputs = inferRouterOutputs<AdminRouter>;
export type AppOutputs = inferRouterOutputs<AppRouter>;

const includeCredentials: typeof fetch = (input, init) =>
  fetch(input, { ...init, credentials: "include" });

/** tRPC client for admin.pas.com. `url` defaults to the dev-proxied mount. */
export function createAdminClient(url = "/trpc/admin") {
  return createTRPCClient<AdminRouter>({
    links: [httpBatchLink({ url, transformer: superjson, fetch: includeCredentials })],
  });
}

/** tRPC client for app.pas.com. `headers` carries the tenant hint when the host can't. */
export function createAppClient(
  url = "/trpc/app",
  headers: () => Record<string, string> = () => ({}),
) {
  return createTRPCClient<AppRouter>({
    links: [httpBatchLink({ url, transformer: superjson, fetch: includeCredentials, headers })],
  });
}

export function createPlatformClient(url = "/trpc/platform") {
  return createTRPCClient<PlatformRouter>({
    links: [httpBatchLink({ url, transformer: superjson, fetch: includeCredentials })],
  });
}

export const adminTrpc = createTRPCContext<AdminRouter>();
export const appTrpc = createTRPCContext<AppRouter>();
export const platformTrpc = createTRPCContext<PlatformRouter>();
