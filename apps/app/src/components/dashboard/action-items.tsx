import type { AppOutputs } from "@pas/api-client";
import { EmptyState } from "@pas/ui/components/empty-state";
import { cn } from "@pas/ui/lib/utils";
import { CircleCheck } from "lucide-react";
import { formatMoney, formatPlainDate } from "@/lib/format";
import { DashboardRows, RowLink } from "./rows";

export type ActionItem = AppOutputs["actionItems"][number];

const COPY: Record<ActionItem["kind"], { title: string; due: string }> = {
  question: { title: "Underwriter has a question", due: "" },
  condition: { title: "Condition outstanding", due: "Due" },
  ready_to_bind: { title: "Approved and ready to bind", due: "Quote expires" },
  quote_expiring: { title: "Quote expiring", due: "Expires" },
  past_due: { title: "Payment past due", due: "Since" },
  cancellation: { title: "Pending cancellation", due: "Cancels" },
  term_expiring: { title: "Renewal coming up", due: "Expires" },
};

export function ActionItems({ items, error }: { items: ActionItem[] | undefined; error: boolean }) {
  if (error) return <EmptyState icon={<CircleCheck />} title="Couldn't load your to-dos" />;

  if (items?.length === 0) {
    return (
      <EmptyState
        icon={<CircleCheck />}
        title="You're all caught up"
        description="Renewals, payments and underwriting asks show up here."
      />
    );
  }

  return (
    <DashboardRows pending={!items}>
      {items?.map((item) => (
        <li key={item.id}>
          <RowLink to={item.subject}>
            <div className="grid min-w-0 flex-1 gap-0.5">
              <span className="truncate text-sm leading-5 font-medium">
                {COPY[item.kind].title}
                {item.detail && <span className="font-normal"> · {item.detail}</span>}
              </span>
              <span className="truncate text-xs text-muted-foreground tabular-nums">
                {item.insuredName ?? "No insured yet"} · {item.reference} · {item.productName}
              </span>
            </div>
            <span className="hidden w-28 text-right text-sm tabular-nums sm:block">
              {item.amount && formatMoney(item.amount, { cents: true })}
            </span>
            <span
              className={cn(
                "w-36 text-right text-xs whitespace-nowrap tabular-nums",
                item.overdue ? "font-medium text-destructive" : "text-muted-foreground",
              )}
            >
              {item.dueOn && `${COPY[item.kind].due} ${formatPlainDate(item.dueOn)}`}
            </span>
          </RowLink>
        </li>
      ))}
    </DashboardRows>
  );
}
