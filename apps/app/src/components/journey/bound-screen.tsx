import { Button } from "@pas/ui/components/button";
import { Card } from "@pas/ui/components/card";
import { IconTile } from "@pas/ui/components/icon-tile";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { formatMoney, formatPlainDate, formatPlainDateRange } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";
import type { StepProps } from "./journey";
import { PolicyDocumentList } from "@/components/policy-documents";
import { SubjectivitiesList } from "@/components/underwriting";

export function BoundScreen({ quote }: StepProps) {
  const trpc = useTRPC();
  const policyId = quote.policy!.id;
  const policy = useQuery(trpc.policies.get.queryOptions({ id: policyId }));

  const facts: [string, string][] = [
    ["Named insured", quote.details.namedInsureds.filter(Boolean).join(", ")],
    ["Term", formatPlainDateRange(quote.term.start, quote.term.end)],
    [
      "Paid",
      quote.payment
        ? `${formatMoney(quote.payment.amount, { cents: true })} · ${quote.payment.brand} ending ${quote.payment.last4}`
        : "–",
    ],
  ];

  return (
    <div className="grid w-full max-w-3xl gap-6">
      <Card>
        <div className="grid gap-6 p-(--card-p)">
          <div className="flex items-start gap-4">
            <IconTile>
              <Check />
            </IconTile>
            <div className="grid gap-1">
              <h1 className="m-0 text-2xl leading-tight font-semibold tracking-tight tabular-nums">
                Policy {quote.policy!.number} is bound.
              </h1>
              <p className="m-0 text-sm text-muted-foreground tabular-nums">
                Coverage starts {formatPlainDate(quote.term.start)}.
              </p>
            </div>
          </div>
          <dl className="m-0 grid gap-4 border-t pt-5 sm:grid-cols-3">
            {facts.map(([label, value]) => (
              <div key={label} className="grid gap-0.5">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="m-0 text-sm tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <section className="border-t">
          <h2 className="m-0 px-(--card-p) pt-4 pb-2 text-sm font-medium">Documents</h2>
          <PolicyDocumentList policyId={policyId} documents={policy.data?.documents} />
        </section>
        <div className="flex flex-wrap justify-end gap-2 border-t bg-muted/50 px-(--card-p) py-3">
          <Button variant="outline" asChild>
            <Link to="/policies/$policyId" params={{ policyId }}>
              View policy
            </Link>
          </Button>
          <Button asChild>
            <Link to="/submissions/new">Start another quote</Link>
          </Button>
        </div>
      </Card>
      <SubjectivitiesList policyId={policyId} title="Still to do after binding" />
    </div>
  );
}
