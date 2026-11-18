import type { AdminOutputs } from "@pas/api-client";
import type { RaterSource, RatingInput } from "@pas/rating-engine/plan";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Contents } from "@/components/catalog/version-editor";
import { trpcClient } from "@/lib/trpc";

export type RatingCheck = AdminOutputs["rating"]["check"];
export type RatingIssue = RatingCheck["issues"][number];
export type RatingPreview = AdminOutputs["rating"]["preview"];
export type RaterWorkbook = AdminOutputs["rating"]["workbooks"]["list"][number];
export type RaterWorkbookDetail = AdminOutputs["rating"]["workbooks"]["get"];

function useDebounced<T>(value: T, delay = 300): T {
  const [current, setCurrent] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setCurrent(value), delay);

    return () => clearTimeout(timer);
  }, [value, delay]);

  return current;
}

export function useRatingCheck(contents: Contents) {
  const key = useDebounced(
    JSON.stringify({
      rating: contents.rating,
      riskSchema: contents.riskSchema,
      coverageCodes: contents.coverages.map((coverage) => coverage.code),
    }),
  );

  return useQuery({
    queryKey: ["rating", "check", key],
    queryFn: () => trpcClient.rating.check.mutate(JSON.parse(key)),
    placeholderData: keepPreviousData,
    staleTime: Infinity,
  });
}

export function sourceOf(rating: Contents["rating"]): RaterSource | null {
  if (!rating) return null;

  return rating.engine === "plan"
    ? { engine: "plan", plan: rating.plan }
    : { engine: "spreadsheet", workbookId: rating.workbookId, manifest: rating.manifest };
}

export function useRatingPreview(source: RaterSource | null, input: RatingInput | null) {
  const key = useDebounced(JSON.stringify({ rating: source, input }), 250);

  return useQuery({
    queryKey: ["rating", "preview", key],
    queryFn: () => trpcClient.rating.preview.mutate(JSON.parse(key)),
    enabled: !!source && !!input,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
  });
}
