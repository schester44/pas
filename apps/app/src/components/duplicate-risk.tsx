import { Notice } from "@pas/ui/components/notice";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTRPC } from "@/lib/trpc";

/** Clearance (PLAN §15.9): another producer already has this location in an active risk. */
export function DuplicateRiskNotice({
  submissionId,
  riskData,
}: {
  submissionId: string;
  riskData?: Record<string, unknown>;
}) {
  const trpc = useTRPC();
  const ids = riskData ? addressIds(riskData).join(",") : null;

  // Re-check only when a stamped address changes, not on every keystroke.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  const checked = useMemo(() => riskData, [ids]);

  const clearance = useQuery({
    ...trpc.submissions.clearance.queryOptions({
      id: submissionId,
      ...(checked && { riskData: checked }),
    }),
    enabled: ids !== "",
  });

  const result = clearance.data;

  if (!result || result.outcome === "clear") return null;

  return (
    <Notice tone={result.outcome === "block" ? "error" : "warning"} title="Possible duplicate risk">
      {result.outcome === "block"
        ? "Another producer already has an active submission or policy at this address, so it can't be quoted again. Contact your underwriter."
        : "Another producer already has an active submission or policy at this address. Your underwriter will review it."}
    </Notice>
  );
}

function addressIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(addressIds);

  if (typeof value !== "object" || value === null) return [];

  const record = value as Record<string, unknown>;
  const own = typeof record.addressId === "string" ? [record.addressId] : [];

  return [...own, ...Object.values(record).flatMap(addressIds)];
}
