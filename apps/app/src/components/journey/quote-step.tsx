import { Button } from "@pas/ui/components/button";
import { Card } from "@pas/ui/components/card";
import { jurisdictionName } from "@pas/ui/lib/jurisdictions";
import { ArrowRight } from "lucide-react";
import { formatMoney, formatPlainDateRange } from "@/lib/format";
import type { StepProps } from "./journey";
import { PayPlanPicker } from "./pay-plans";
import { PremiumBreakdown } from "./premium";

export function QuoteStep({ quote, submission, go }: StepProps) {
  return (
    <div className="grid gap-6">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-6 p-(--card-p)">
          <div className="grid gap-1">
            <p className="m-0 text-sm text-muted-foreground">Total for the term</p>
            <p className="m-0 text-4xl leading-10 font-semibold tracking-tight tabular-nums">
              {formatMoney(quote.premium.total, { cents: true })}
            </p>
            <p className="m-0 text-sm text-muted-foreground tabular-nums">
              {formatPlainDateRange(quote.term.start, quote.term.end)} ·{" "}
              {jurisdictionName(submission.jurisdiction)}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => go("customize")}>
              Customize coverage
            </Button>
            <Button onClick={() => go("details")}>
              Continue <ArrowRight />
            </Button>
          </div>
        </div>
        <div className="border-t">
          <PremiumBreakdown quote={quote} />
        </div>
      </Card>
      <PayPlanPicker quote={quote} submissionId={submission.id} />
    </div>
  );
}
