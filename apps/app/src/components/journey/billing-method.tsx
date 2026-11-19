import { Panel } from "@pas/ui/components/panel";
import { RadioGroup, RadioGroupItem } from "@pas/ui/components/radio-group";
import { cn } from "@pas/ui/lib/utils";
import { formatMoney } from "@/lib/format";
import type { Quote } from "@/lib/quotes";

export type BillingMethod = "direct" | "agency" | "mortgagee";

export interface BillingOption {
  method: BillingMethod;
  available: boolean;
  reason: string | null;
  payer: { name: string; reference: string | null } | null;
  payPlan: string | null;
}

const TITLES: Record<BillingMethod, string> = {
  direct: "Direct bill",
  agency: "Agency bill",
  mortgagee: "Mortgagee bill",
};

function describe(option: BillingOption, quote: Quote): string {
  if (!option.available) return option.reason ?? "Not available for this quote";

  const total = formatMoney(quote.premium.total, { cents: true });

  switch (option.method) {
    case "direct":
      return "The insured pays by card now.";
    case "agency":
      return `${total} goes on ${option.payer?.name ?? "the agency"}'s next account current. Nothing is collected now.`;
    case "mortgagee":
      return `${option.payer?.name ?? "The lender"}${option.payer?.reference ? ` (loan ${option.payer.reference})` : ""} is invoiced ${total}. The policy is in force while the lender pays.`;
  }
}

/** Who pays at bind (PLAN §13): the insured by card, the agency on account current, or the lender. */
export function BillingMethodChoice({
  options,
  value,
  onChange,
  quote,
}: {
  options: BillingOption[];
  value: BillingMethod;
  onChange: (method: BillingMethod) => void;
  quote: Quote;
}) {
  return (
    <Panel title="Billing" description="Who pays the premium." flush>
      <RadioGroup
        value={value}
        onValueChange={(method) => onChange(method as BillingMethod)}
        className="gap-0 divide-y"
        aria-label="Billing method"
      >
        {options.map((option) => (
          <label
            key={option.method}
            className={cn(
              "flex items-start gap-3 px-(--card-p) py-3.5 transition-colors",
              option.available ? "cursor-pointer" : "cursor-not-allowed",
              option.method === value ? "bg-primary/5" : option.available && "hover:bg-muted/40",
            )}
          >
            <RadioGroupItem value={option.method} disabled={!option.available} className="mt-0.5" />
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span
                className={cn(
                  "text-sm leading-5 font-medium",
                  !option.available && "text-muted-foreground",
                )}
              >
                {TITLES[option.method]}
              </span>
              <span className="text-sm text-muted-foreground tabular-nums">
                {describe(option, quote)}
              </span>
            </span>
          </label>
        ))}
      </RadioGroup>
    </Panel>
  );
}
