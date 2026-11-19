import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useTRPC } from "./trpc";

/** Counts a page visit toward the user's "recently viewed" in search, on every device. */
export function useRecordView(type: "policy" | "submission" | "client", id: string) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const { mutate } = useMutation(
    trpc.search.viewed.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.search.recent.queryKey() }),
    }),
  );

  useEffect(() => {
    mutate({ type, id });
  }, [mutate, type, id]);
}
