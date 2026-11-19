import { type AddressLookup, AddressLookupProvider } from "@pas/forms-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type * as React from "react";
import { useMemo } from "react";
import { useTRPC } from "./trpc";

/** Address autocomplete and verification through the tenant's address registry. */
export function AddressLookupBoundary({ children }: { children: React.ReactNode }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { mutateAsync: verify } = useMutation(trpc.addresses.verify.mutationOptions());

  const lookup = useMemo<AddressLookup>(
    () => ({
      suggest: (text, selected) =>
        queryClient.fetchQuery({
          ...trpc.addresses.suggest.queryOptions({ text, ...(selected && { selected }) }),
          staleTime: 60_000,
        }),
      verify: async (address) => {
        const result = await verify({ address });

        return {
          value: result.value,
          status: result.record.status,
          notes: result.notes,
          county: result.record.county?.name ?? null,
        };
      },
    }),
    [trpc, queryClient, verify],
  );

  return <AddressLookupProvider value={lookup}>{children}</AddressLookupProvider>;
}
