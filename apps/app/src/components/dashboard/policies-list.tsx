import type { AppOutputs } from "@pas/api-client";
import { EmptyState } from "@pas/ui/components/empty-state";
import { StatusChip } from "@pas/ui/components/status-chip";
import { jurisdictionName } from "@pas/ui/lib/jurisdictions";
import { ScrollText } from "lucide-react";
import { formatMoney, formatPlainDateRange } from "@/lib/format";
import { TERM_STATUS } from "@/lib/policies";
import { DashboardRows, RowLink } from "./rows";

type Policy = AppOutputs["policies"]["list"][number];

export function PoliciesList({
  policies,
  error,
}: {
  policies: Policy[] | undefined;
  error: boolean;
}) {
  if (error) {
    return (
      <EmptyState
        icon={<ScrollText />}
        title="Couldn't load your policies"
        description="Refresh the page to try again."
      />
    );
  }

  if (policies?.length === 0) {
    return (
      <EmptyState
        icon={<ScrollText />}
        title="No policies yet"
        description="Quotes you bind show up here."
      />
    );
  }

  return (
    <DashboardRows pending={!policies}>
      {policies?.map((policy) => {
        const status = TERM_STATUS[policy.status] ?? { label: policy.status, tone: "neutral" };

        return (
          <li key={policy.id}>
            <RowLink to={{ kind: "policy", id: policy.id }}>
              <div className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate text-sm leading-5 font-medium">{policy.insuredName}</span>
                <span className="text-xs text-muted-foreground tabular-nums sm:truncate">
                  {policy.number} · {policy.productName} · {jurisdictionName(policy.jurisdiction)} ·{" "}
                  {formatPlainDateRange(policy.effectiveDate, policy.expirationDate)}
                </span>
              </div>
              <span className="hidden w-28 text-right text-sm tabular-nums sm:block">
                {formatMoney(policy.writtenPremium, { cents: true })}
              </span>
              <span className="flex w-40 justify-end">
                <StatusChip tone={status.tone}>{status.label}</StatusChip>
              </span>
            </RowLink>
          </li>
        );
      })}
    </DashboardRows>
  );
}
