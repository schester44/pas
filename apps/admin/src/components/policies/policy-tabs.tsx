import { cn } from "@pas/ui/lib/utils";
import { Link } from "@tanstack/react-router";

export const POLICY_TABS = [
  { value: "overview", label: "Overview" },
  { value: "coverage", label: "Coverage" },
  { value: "activity", label: "Activity" },
  { value: "billing", label: "Billing" },
  { value: "documents", label: "Documents" },
  { value: "transactions", label: "Transactions" },
] as const;

export type PolicyTab = (typeof POLICY_TABS)[number]["value"];

export const isPolicyTab = (value: unknown): value is PolicyTab =>
  POLICY_TABS.some((tab) => tab.value === value);

/** Underlined tabs that live in the URL; they scroll sideways on narrow screens. */
export function PolicyTabs({
  policyId,
  current,
  counts,
}: {
  policyId: string;
  current: PolicyTab;
  counts?: Partial<Record<PolicyTab, number>>;
}) {
  return (
    <nav
      aria-label="Policy sections"
      className="-mx-4 overflow-x-auto border-b px-4 [scrollbar-width:none] sm:mx-0 sm:px-0"
    >
      <ul className="m-0 flex w-max list-none gap-6 p-0">
        {POLICY_TABS.map((tab) => {
          const active = tab.value === current;
          const count = counts?.[tab.value];

          return (
            <li key={tab.value}>
              <Link
                to="/policies/$policyId"
                params={{ policyId }}
                search={tab.value === "overview" ? {} : { tab: tab.value }}
                resetScroll={false}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-10 items-center gap-1.5 text-sm font-medium whitespace-nowrap outline-none transition-colors",
                  "after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full",
                  "focus-visible:text-foreground",
                  active
                    ? "text-foreground after:bg-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
                {count !== undefined && count > 0 && (
                  <span className="text-xs font-normal text-muted-foreground tabular-nums">
                    {count}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
