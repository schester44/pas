import { Panel } from "@pas/ui/components/panel";
import { RadioGroup, RadioGroupItem } from "@pas/ui/components/radio-group";
import { cn } from "@pas/ui/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { formatMoney, formatPlainDate } from "@/lib/format";
import type { Quote } from "@/lib/quotes";
import { useTRPC } from "@/lib/trpc";

type Offer = Quote["payPlans"][number];

const every = (months: number) => (months === 1 ? "every month" : `every ${months} months`);

/** "$412.18 today, then 3 × $378.40 every 3 months". */
export function scheduleSummary(offer: Offer): string {
  const today = formatMoney(offer.dueToday, { cents: true });

  if (offer.installments <= 1 || !offer.regular) return `${today} today`;

  if (offer.installments === 2) {
    return `${today} today, then ${formatMoney(offer.regular, { cents: true })} in ${offer.intervalMonths} months`;
  }

  return `${today} today, then ${offer.installments - 1} × ${formatMoney(offer.regular, { cents: true })} ${every(offer.intervalMonths)}`;
}

export const selectedOffer = (quote: Quote) =>
  quote.payPlans.find((p) => p.key === quote.payPlan) ?? null;

/** The quote's eligible pay plans with their schedules; picking one saves it on the quote. */
export function PayPlanPicker({ quote, submissionId }: { quote: Quote; submissionId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const choose = useMutation(
    trpc.quotes.choosePayPlan.mutationOptions({
      onSuccess: (updated) =>
        queryClient.setQueryData(trpc.quotes.get.queryKey({ submissionId }), updated),
    }),
  );

  if (quote.payPlans.length === 0) return null;

  const selected = choose.isPending ? choose.variables.payPlan : quote.payPlan;
  const current = quote.payPlans.find((p) => p.key === selected);

  return (
    <Panel title="Pay plan" description="How the premium is paid over the term." flush>
      <RadioGroup
        value={selected ?? undefined}
        onValueChange={(payPlan) => choose.mutate({ submissionId, payPlan })}
        className="gap-0 divide-y"
        aria-label="Pay plan"
      >
        {quote.payPlans.map((offer) => (
          <label
            key={offer.key}
            className={cn(
              "flex cursor-pointer items-start gap-3 px-(--card-p) py-3.5 transition-colors",
              offer.key === selected ? "bg-primary/5" : "hover:bg-muted/40",
            )}
          >
            <RadioGroupItem value={offer.key} className="mt-0.5" />
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="text-sm leading-5 font-medium">{offer.label}</span>
              <span className="text-sm text-muted-foreground tabular-nums">
                {scheduleSummary(offer)}
              </span>
            </span>
            <span className="text-right text-sm tabular-nums">
              {formatMoney(offer.total, { cents: true })}
              {offer.installmentFee && (
                <span className="block text-xs text-muted-foreground">
                  incl. {formatMoney(offer.installmentFee, { cents: true })} per installment
                </span>
              )}
            </span>
          </label>
        ))}
      </RadioGroup>
      {current && current.installments > 1 && (
        <ol className="m-0 grid list-none gap-1 border-t bg-muted/40 px-(--card-p) py-3 text-xs text-muted-foreground">
          {current.schedule.map((item) => (
            <li key={item.number} className="flex justify-between tabular-nums">
              <span>
                {item.number === 1
                  ? "Due at bind"
                  : `${item.number}. Due ${formatPlainDate(item.dueOn)}`}
              </span>
              <span>{formatMoney(item.amount, { cents: true })}</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
