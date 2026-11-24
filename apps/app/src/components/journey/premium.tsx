import { Card } from "@pas/ui/components/card";
import { Spinner } from "@pas/ui/components/spinner";
import { cn } from "@pas/ui/lib/utils";
import type * as React from "react";
import { useEffect, useState } from "react";
import {
  formatMoney,
  formatPlainDate,
  formatPlainDateRange,
  formatSignedMoney,
  type MoneyValue,
} from "@/lib/format";
import { amountLabel, type Quote } from "@/lib/quotes";
import { useCarrierPhase } from "./carrier";

const percent = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 3 });

const scramble = (currency: string): MoneyValue => ({
  amount: (1000 + Math.random() * 9000).toFixed(2),
  currency,
});

function CrunchingMoney({ currency }: { currency: string }) {
  const [shown, setShown] = useState(() => scramble(currency));

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const timer = window.setInterval(() => setShown(scramble(currency)), 80);

    return () => window.clearInterval(timer);
  }, [currency]);

  return (
    <span role="status" aria-label="Crunching the numbers" className="text-muted-foreground/70">
      <span aria-hidden>{formatMoney(shown, { cents: true })}</span>
    </span>
  );
}

/** The term total: rolling digits while the carrier prices it, a dash if it never did. */
export function TotalPrice({ quote }: { quote: Quote }) {
  const { pricing, noPrice } = useCarrierPhase(quote);

  if (pricing) return <CrunchingMoney currency={quote.currency} />;

  if (noPrice) return <Dash />;

  return formatMoney(quote.premium.total, { cents: true });
}

function Price({
  quote,
  value,
  cents = true,
}: {
  quote: Quote;
  value: MoneyValue;
  cents?: boolean;
}) {
  const { pricing, noPrice } = useCarrierPhase(quote);

  if (pricing) {
    return (
      <span
        aria-hidden
        className="inline-block h-4 w-14 animate-pulse rounded bg-muted align-middle"
      />
    );
  }

  return noPrice ? <Dash /> : formatMoney(value, { cents });
}

export function rateLabel(line: Quote["premium"]["taxesFees"][number]) {
  return line.rate === undefined ? null : percent.format(Number(line.rate));
}

export const taxesAndFees = (quote: Quote): MoneyValue => ({
  amount: (Number(quote.premium.total.amount) - Number(quote.premium.written.amount)).toFixed(2),
  currency: quote.currency,
});

/** Premium by coverage and exposure, then taxes and fees, then the total. */
export function PremiumBreakdown({ quote }: { quote: Quote }) {
  const rows = quote.coverages.flatMap((coverage) =>
    coverage.exposures
      .filter((exposure) => exposure.selected)
      .map((exposure) => ({ coverage, exposure })),
  );

  return (
    <div className="grid text-sm">
      <div className="hidden h-10 grid-cols-[minmax(0,1fr)_8rem_7rem_7rem] items-center gap-4 border-b bg-muted/40 px-(--card-p) text-xs font-medium text-muted-foreground sm:grid">
        <span>Coverage</span>
        <span className="text-right">Limit</span>
        <span className="text-right">Deductible</span>
        <span className="text-right">Premium</span>
      </div>
      <ul className="m-0 list-none divide-y p-0">
        {rows.map(({ coverage, exposure }) => (
          <li
            key={`${coverage.code}@${exposure.exposure ?? ""}`}
            className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 px-(--card-p) py-3 sm:grid-cols-[minmax(0,1fr)_8rem_7rem_7rem] sm:items-center"
          >
            <span className="grid min-w-0 gap-0.5">
              <span className="font-medium">{coverage.name}</span>
              {exposure.label && (
                <span className="truncate text-xs text-muted-foreground">{exposure.label}</span>
              )}
              <span className="text-xs text-muted-foreground tabular-nums sm:hidden">
                {[
                  exposure.limit && amountLabel(exposure.limit),
                  exposure.deductible && `${amountLabel(exposure.deductible)} deductible`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
            <Amount className="hidden sm:block">
              {exposure.limit ? amountLabel(exposure.limit) : <Dash />}
            </Amount>
            <Amount className="hidden sm:block">
              {exposure.deductible ? amountLabel(exposure.deductible) : <Dash />}
            </Amount>
            <Amount className="row-span-3 self-start sm:row-span-1 sm:self-auto">
              {exposure.premium ? (
                <Price quote={quote} value={exposure.premium} cents={false} />
              ) : (
                <Dash />
              )}
            </Amount>
          </li>
        ))}
      </ul>
      <dl className="m-0 grid gap-2 border-t bg-muted/30 px-(--card-p) py-4">
        <Line label="Premium" value={<Price quote={quote} value={quote.premium.written} />} />
        {quote.premium.taxesFees.map((line) => (
          <Line
            key={line.code}
            label={line.label}
            meta={rateLabel(line)}
            value={<Price quote={quote} value={line.amount} />}
          />
        ))}
        <Line
          strong
          label="Total"
          value={<Price quote={quote} value={quote.premium.total} />}
          className="mt-1 border-t pt-3"
        />
      </dl>
    </div>
  );
}

function Line({
  label,
  meta,
  value,
  strong,
  className,
}: {
  label: string;
  meta?: string | null;
  value: React.ReactNode;
  strong?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4", className)}>
      <dt className={cn(strong ? "font-semibold" : "text-muted-foreground")}>
        {label}
        {meta && <span className="ml-1.5 text-xs tabular-nums">{meta}</span>}
      </dt>
      <dd className={cn("m-0 tabular-nums", strong && "font-semibold")}>{value}</dd>
    </div>
  );
}

function Amount({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("text-right tabular-nums", className)}>{children}</span>;
}

function Dash() {
  return <span className="text-muted-foreground">–</span>;
}

/** The sticky total beside the later steps, with the change from the last price. */
export function PremiumSummary({
  quote,
  change,
  busy,
  children,
}: {
  quote: Quote;
  change?: MoneyValue | null;
  busy?: boolean;
  children?: React.ReactNode;
}) {
  const delta = change && Number(change.amount) !== 0 ? change : null;

  return (
    <Card className="lg:sticky lg:top-20">
      <div className="grid gap-4 p-(--card-p)">
        <div className="grid gap-1">
          <p className="m-0 flex items-center gap-2 text-sm text-muted-foreground">
            Total for the term {busy && <Spinner className="size-3.5" />}
          </p>
          <p
            className={cn(
              "m-0 text-3xl leading-9 font-semibold tracking-tight tabular-nums transition-opacity",
              busy && "opacity-60",
            )}
          >
            <TotalPrice quote={quote} />
          </p>
          {change !== undefined && (
            <p
              aria-live="polite"
              className={cn(
                "m-0 h-5 text-sm tabular-nums",
                delta && Number(delta.amount) < 0 ? "text-emerald-700" : "text-muted-foreground",
              )}
            >
              {delta && `${formatSignedMoney(delta)} from the last price`}
            </p>
          )}
        </div>
        <dl className="m-0 grid gap-2 border-t pt-4 text-sm">
          <Line label="Premium" value={<Price quote={quote} value={quote.premium.written} />} />
          <Line
            label="Taxes and fees"
            value={<Price quote={quote} value={taxesAndFees(quote)} />}
          />
          <Line label="Term" value={formatPlainDateRange(quote.term.start, quote.term.end)} />
          <Line label="Valid until" value={formatPlainDate(quote.expiresAt.slice(0, 10))} />
        </dl>
      </div>
      {children && <div className="border-t bg-muted/50 px-(--card-p) py-3">{children}</div>}
    </Card>
  );
}
