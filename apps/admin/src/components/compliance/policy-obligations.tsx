import { Panel } from "@pas/ui/components/panel";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { formatPlainDate } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";
import { ObligationState } from "./labels";

/** The policy's compliance obligations, for the policy page to mount. */
export function PolicyObligations({ policyId }: { policyId: string }) {
  const trpc = useTRPC();
  const obligations = useQuery(trpc.compliance.list.queryOptions({ policyId, view: "all" }));

  if (!obligations.data?.length) return null;

  return (
    <Panel title="Compliance" flush>
      <ul className="m-0 list-none divide-y p-0">
        {obligations.data.map((o) => (
          <li key={o.id}>
            <Link
              to="/compliance/$obligationId"
              params={{ obligationId: o.id }}
              className="flex items-center justify-between gap-3 px-(--card-p) py-3 outline-none hover:bg-muted/40 focus-visible:bg-muted/40"
            >
              <span className="grid min-w-0 gap-0.5">
                <span className="truncate text-sm leading-5 font-medium">{o.title}</span>
                <span className="truncate text-xs text-muted-foreground tabular-nums">
                  {o.filingNumber ?? `Due ${formatPlainDate(o.dueDate)}`} ·{" "}
                  {(o.subject.transactionType ?? "").toLowerCase().replaceAll("_", " ")}
                </span>
              </span>
              <ObligationState obligation={o} />
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
