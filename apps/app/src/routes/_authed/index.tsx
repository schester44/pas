import { Button } from "@pas/ui/components/button";
import { Panel } from "@pas/ui/components/panel";
import { SegmentedControl } from "@pas/ui/components/segmented-control";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { ActionItems } from "@/components/dashboard/action-items";
import { PoliciesList } from "@/components/dashboard/policies-list";
import { SubmissionsList } from "@/components/dashboard/submissions-list";
import { useTRPC } from "@/lib/trpc";

const TABS = ["todo", "submissions", "policies"] as const;

type Tab = (typeof TABS)[number];

const isTab = (value: unknown): value is Tab => TABS.includes(value as Tab);

export const Route = createFileRoute("/_authed/")({
  validateSearch: (search: Record<string, unknown>): { tab?: Exclude<Tab, "todo"> } =>
    isTab(search.tab) && search.tab !== "todo" ? { tab: search.tab } : {},
  component: HomePage,
});

function HomePage() {
  const trpc = useTRPC();
  const navigate = Route.useNavigate();
  const tab = Route.useSearch().tab ?? "todo";
  const me = useQuery(trpc.me.queryOptions());
  const firstName = me.data?.user.name.split(" ")[0];

  const todo = useQuery({ ...trpc.actionItems.queryOptions(), refetchInterval: 60_000 });

  const submissions = useQuery({
    ...trpc.submissions.list.queryOptions({ limit: 100 }),
    enabled: tab === "submissions",
  });

  const policies = useQuery({
    ...trpc.policies.list.queryOptions({ limit: 100 }),
    enabled: tab === "policies",
  });

  const count = todo.data?.length ?? 0;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-1">
          <h1 className="m-0 text-2xl leading-tight font-semibold tracking-tight">
            {firstName ? `Hi, ${firstName}` : "Welcome"}
          </h1>
          <p className="m-0 text-sm text-muted-foreground">
            {count > 0
              ? `${count} ${count === 1 ? "thing needs" : "things need"} your attention.`
              : "Pick up a draft or start a new quote."}
          </p>
        </div>
        <Button asChild>
          <Link to="/submissions/new">
            <Plus /> Start a quote
          </Link>
        </Button>
      </div>
      <Panel flush>
        <div className="border-b px-(--card-p) py-3">
          <SegmentedControl
            label="Dashboard view"
            value={tab}
            onValueChange={(next) =>
              navigate({ search: next === "todo" ? {} : { tab: next }, replace: true })
            }
            options={[
              {
                value: "todo",
                label: (
                  <>
                    To do
                    {count > 0 && (
                      <span className="rounded-full bg-primary px-1.5 text-[11px] leading-4 font-semibold text-primary-foreground tabular-nums">
                        {count}
                      </span>
                    )}
                  </>
                ),
              },
              { value: "submissions", label: "Submissions" },
              { value: "policies", label: "Policies" },
            ]}
          />
        </div>
        {tab === "todo" && <ActionItems items={todo.data} error={!!todo.error} />}
        {tab === "submissions" && (
          <SubmissionsList submissions={submissions.data} error={submissions.error} />
        )}
        {tab === "policies" && <PoliciesList policies={policies.data} error={!!policies.error} />}
      </Panel>
    </>
  );
}
