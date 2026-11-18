import { adminTrpc, createAdminClient } from "@pas/api-client";
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: false } },
});

export const trpcClient = createAdminClient();

export const { TRPCProvider, useTRPC } = adminTrpc;
