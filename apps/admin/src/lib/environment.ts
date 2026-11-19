import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "./trpc";

export function isSandboxOrganization(org: { metadata?: unknown }): boolean {
  const metadata =
    typeof org.metadata === "string" ? (JSON.parse(org.metadata) as unknown) : org.metadata;

  return (metadata as { environment?: string } | null)?.environment === "sandbox";
}

export function useEnvironment() {
  const trpc = useTRPC();

  return useQuery({ ...trpc.tenant.environment.queryOptions(), staleTime: 5_000 });
}
