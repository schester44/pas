import { Panel } from "@pas/ui/components/panel";
import { useQuery } from "@tanstack/react-query";
import { Money } from "@pas/kernel";
import { CapturedData } from "@/components/submissions/captured-data";
import { useTRPC } from "@/lib/trpc";
import { formatMoney } from "@/lib/format";
import { exposureLabel } from "@pas/ui/lib/policy-change";
import { amount, type Coverage, type Policy } from "./policy-format";

/** Coverages by exposure with limits, deductibles and premium, then the risk as last issued. */
export function PolicyCoverage({ policy }: { policy: Policy }) {
  const groups = Map.groupBy(policy.coverages, (c) => c.exposure ?? "");

  return (
    <div className="grid gap-8">
      <div className="grid gap-6">
        {[...groups].map(([exposure, coverages]) => (
          <CoverageGroup key={exposure} exposure={exposure} coverages={coverages} />
        ))}
      </div>
      <RiskDetails policy={policy} />
    </div>
  );
}

function premiumOf(coverages: Coverage[]) {
  const [first, ...rest] = coverages.map((c) => Money.of(c.premium.amount, c.premium.currency));

  return first ? rest.reduce((sum, m) => sum.plus(m), first).toJSON() : null;
}

function CoverageGroup({ exposure, coverages }: { exposure: string; coverages: Coverage[] }) {
  const premium = premiumOf(coverages);

  return (
    <Panel
      title={exposureLabel(exposure || undefined) ?? "Policy"}
      description={`${coverages.length} ${coverages.length === 1 ? "coverage" : "coverages"}`}
      action={
        premium && (
          <span className="text-sm text-muted-foreground">
            Premium{" "}
            <span className="font-medium text-foreground tabular-nums">{formatMoney(premium)}</span>
          </span>
        )
      }
      flush
    >
      <div className="hidden h-10 grid-cols-[minmax(0,1fr)_9rem_9rem_8rem] items-center gap-3 bg-muted/40 px-(--card-p) text-xs font-medium text-muted-foreground sm:grid">
        <span>Coverage</span>
        <span className="text-right">Limit</span>
        <span className="text-right">Deductible</span>
        <span className="text-right">Premium</span>
      </div>
      <ul className="m-0 list-none divide-y p-0 sm:border-t">
        {coverages.map((c) => (
          <li
            key={c.coverage}
            className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-(--card-p) py-3 sm:min-h-13 sm:grid-cols-[minmax(0,1fr)_9rem_9rem_8rem] sm:items-center"
          >
            <span className="text-sm font-medium">{c.name}</span>
            <span className="text-sm tabular-nums sm:order-last sm:text-right">
              {formatMoney(c.premium)}
            </span>
            <span className="col-span-2 text-xs text-muted-foreground tabular-nums sm:col-span-1 sm:text-right sm:text-sm sm:text-foreground">
              <span className="sm:hidden">Limit </span>
              {amount(c.limit)}
            </span>
            <span className="col-span-2 -mt-1 text-xs text-muted-foreground tabular-nums sm:col-span-1 sm:mt-0 sm:text-right sm:text-sm sm:text-foreground">
              <span className="sm:hidden">Deductible </span>
              {amount(c.deductible)}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function RiskDetails({ policy }: { policy: Policy }) {
  const trpc = useTRPC();
  const risk = useQuery(trpc.policies.risk.queryOptions({ id: policy.id }));

  return (
    <section className="grid gap-4">
      <div className="grid gap-1">
        <h2 className="m-0 text-base leading-6 font-semibold">Risk details</h2>
        <p className="m-0 text-sm text-muted-foreground">As of the latest issued change.</p>
      </div>
      {risk.error || risk.data?.form === null ? (
        <p className="m-0 text-sm text-muted-foreground">Risk details aren't available.</p>
      ) : !risk.data?.form ? (
        <div className="h-64 animate-pulse rounded-xl bg-muted/60" />
      ) : (
        <CapturedData schema={risk.data.schema} form={risk.data.form} data={risk.data.risk} />
      )}
    </section>
  );
}
