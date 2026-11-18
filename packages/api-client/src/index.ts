import type { AdminRouter, AppRouter } from "@pas/api/router";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import superjson from "superjson";

export type { AdminRouter, AppRouter };

const includeCredentials: typeof fetch = (input, init) =>
  fetch(input, { ...init, credentials: "include" });

/** tRPC client for admin.pas.com. `url` defaults to the dev-proxied mount. */
export function createAdminClient(url = "/trpc/admin") {
  return createTRPCClient<AdminRouter>({
    links: [httpBatchLink({ url, transformer: superjson, fetch: includeCredentials })],
  });
}

/** tRPC client for app.pas.com. */
export function createAppClient(url = "/trpc/app") {
  return createTRPCClient<AppRouter>({
    links: [httpBatchLink({ url, transformer: superjson, fetch: includeCredentials })],
  });
}

export const adminTrpc = createTRPCContext<AdminRouter>();
export const appTrpc = createTRPCContext<AppRouter>();
