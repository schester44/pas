import type * as React from "react";
import { cn } from "../lib/utils";
import { exposureLabel, type MoneyValue, money } from "../lib/policy-change";

export interface PremiumPreview {
  type: string;
  effectiveDate: string;
  total: MoneyValue;
  annualBefore: MoneyValue | null;
  annualAfter: MoneyValue | null;
  premium: {
    coverage: string;
    exposure?: string;
    name: string;
    before: MoneyValue;
    after: MoneyValue;
    amount: MoneyValue;
  }[];
  retained: { name: string; minimum: MoneyValue; amount: MoneyValue }[];
  fees: { code: string; label: string; amount: MoneyValue }[];
  cancellation?: {
    minimumEarned: {
      type: string;
      value: string;
      level: string;
      minimum: MoneyValue;
      retained: MoneyValue;
    } | null;
    fullyEarnedFees: string[];
  } | null;
}

function Row({
  label,
  meta,
  amount,
  strong,
}: {
  label: React.ReactNode;
  meta?: React.ReactNode;
  amount: string;
  strong?: boolean;
}) {
  return (
    <li className="flex items-start justify-between gap-4 py-2.5">
      <span className="grid min-w-0 gap-0.5">
        <span className={cn("text-sm", strong && "font-medium")}>{label}</span>
        {meta && <span className="text-xs text-muted-foreground tabular-nums">{meta}</span>}
      </span>
      <span className={cn("text-sm whitespace-nowrap tabular-nums", strong && "font-medium")}>
        {amount}
      </span>
    </li>
  );
}

const whole = (value: MoneyValue) => money(value).replace(/\.00$/, "");

const minimumText = (
  m: NonNullable<NonNullable<PremiumPreview["cancellation"]>["minimumEarned"]>,
) =>
  `Minimum earned premium of ${m.type === "percent" ? `${m.value}%` : money(m.minimum)} applies: ${money(m.retained)} retained`;

/**
 * The prorated premium change by coverage, minimum earned premium, taxes and fees, and the net
 * the transaction bills or credits. One component for endorsements, cancellations and reinstatements.
 */
function PremiumChange({ preview, className }: { preview: PremiumPreview; className?: string }) {
  const credit = Number(preview.total.amount) < 0;
  const mep = preview.cancellation?.minimumEarned;

  const neutral =
    preview.premium.length === 0 && preview.fees.length === 0 && preview.retained.length === 0;

  return (
    <div className={cn("grid gap-4", className)}>
      {mep && (
        <p className="m-0 flex items-start gap-2 text-sm">
          <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500" />
          {minimumText(mep)}
        </p>
      )}
      {neutral ? (
        <p className="m-0 text-sm text-muted-foreground">No premium change. Nothing is billed.</p>
      ) : (
        <ul className="m-0 grid list-none divide-y p-0">
          {preview.premium.map((line) => (
            <Row
              key={`${line.coverage}@${line.exposure ?? ""}`}
              label={[line.name, exposureLabel(line.exposure)].filter(Boolean).join(" · ")}
              meta={
                preview.type === "ENDORSEMENT"
                  ? `Annual ${whole(line.before)} → ${whole(line.after)}`
                  : `Annual ${whole(Number(line.before.amount) === 0 ? line.after : line.before)}`
              }
              amount={money(line.amount, { signed: true })}
            />
          ))}
          {preview.retained.map((line) => (
            <Row
              key={line.name}
              label={line.name}
              meta={`Earned at least ${whole(line.minimum)}`}
              amount={money(line.amount, { signed: true })}
            />
          ))}
          {preview.fees.map((line) => (
            <Row key={line.code} label={line.label} amount={money(line.amount, { signed: true })} />
          ))}
        </ul>
      )}
      {!neutral && (
        <dl className="m-0 grid gap-1.5 border-t pt-3 text-sm tabular-nums">
          <div className="flex justify-between gap-4 font-medium">
            <dt>{credit ? "Return premium" : "Due now"}</dt>
            <dd className="m-0">{money(preview.total, { absolute: true })}</dd>
          </div>
          {preview.annualAfter &&
            preview.annualBefore &&
            preview.annualAfter.amount !== preview.annualBefore.amount && (
              <div className="flex justify-between gap-4 text-muted-foreground">
                <dt>Annual premium</dt>
                <dd className="m-0 whitespace-nowrap">
                  {whole(preview.annualBefore)} → {whole(preview.annualAfter)}
                </dd>
              </div>
            )}
          {preview.cancellation && preview.cancellation.fullyEarnedFees.length > 0 && (
            <div className="flex justify-between gap-4 text-muted-foreground">
              <dt>Fully earned, not returned</dt>
              <dd className="m-0">
                {preview.cancellation.fullyEarnedFees
                  .map((f) => f.replaceAll("_", " ").toLowerCase())
                  .join(", ")}
              </dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}

export { PremiumChange };
