import { appTrpc, createAppClient } from "@pas/api-client";
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: false } },
});

export const trpcClient = createAppClient();

export const { TRPCProvider, useTRPC } = appTrpc;
