import { Button } from "@pas/ui/components/button";
import { Card } from "@pas/ui/components/card";
import { jurisdictionName } from "@pas/ui/lib/jurisdictions";
import { ArrowRight } from "lucide-react";
import { formatPlainDateRange } from "@/lib/format";
import type { StepProps } from "./journey";
import { PayPlanPicker } from "./pay-plans";
import { awaitsCarrierPrice, useCarrierPhase } from "./carrier";
import { PremiumBreakdown, TotalPrice } from "./premium";

export function QuoteStep({ quote, submission, go }: StepProps) {
  const pending = useCarrierPhase(quote).pricing;
  const blocked = awaitsCarrierPrice(quote);

  return (
    <div className="grid gap-6">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-6 p-(--card-p)">
          <div className="grid gap-1">
            <p className="m-0 text-sm text-muted-foreground">Total for the term</p>
            <p className="m-0 text-4xl leading-10 font-semibold tracking-tight tabular-nums">
              <TotalPrice quote={quote} />
            </p>
            <p className="m-0 text-sm text-muted-foreground tabular-nums">
              {pending
                ? "Crunching the numbers…"
                : `${formatPlainDateRange(quote.term.start, quote.term.end)} · ${jurisdictionName(submission.jurisdiction)}`}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" disabled={blocked} onClick={() => go("customize")}>
              Customize coverage
            </Button>
            <Button disabled={blocked} onClick={() => go("details")}>
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
