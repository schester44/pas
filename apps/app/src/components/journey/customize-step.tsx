import { Button } from "@pas/ui/components/button";
import { Checkbox } from "@pas/ui/components/checkbox";
import { Label } from "@pas/ui/components/label";
import { Notice } from "@pas/ui/components/notice";
import { Panel } from "@pas/ui/components/panel";
import { SegmentedControl } from "@pas/ui/components/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pas/ui/components/select";
import { cn } from "@pas/ui/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { useRef, useState } from "react";
import { formatMoney, formatSignedMoney, type MoneyValue } from "@/lib/format";
import {
  amountLabel,
  type CoverageAmount,
  type Quote,
  type QuoteCoverage,
  sameAmount,
} from "@/lib/quotes";
import { useTRPC } from "@/lib/trpc";
import type { StepProps } from "./journey";
import { PayPlanPicker } from "./pay-plans";
import { PremiumSummary } from "./premium";

interface Choice {
  coverage: string;
  exposure?: string;
  limit?: CoverageAmount;
  deductible?: CoverageAmount;
}

const slot = (coverage: string, exposure?: string | null) => `${coverage}@${exposure ?? ""}`;

function selectionOf(quote: Quote): Choice[] {
  return quote.coverages.flatMap((coverage) =>
    coverage.exposures
      .filter((e) => e.selected)
      .map((e) => ({
        coverage: coverage.code,
        ...(e.exposure && { exposure: e.exposure }),
        ...(e.limit && { limit: e.limit }),
        ...(e.deductible && { deductible: e.deductible }),
      })),
  );
}

function premiumsOf(quote: Quote): Map<string, number> {
  return new Map(
    quote.coverages.flatMap((c) =>
      c.exposures.map((e) => [slot(c.code, e.exposure), Number(e.premium?.amount ?? 0)] as const),
    ),
  );
}

export function CustomizeStep({ quote, submission, go }: StepProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const key = trpc.quotes.get.queryKey({ submissionId: submission.id });
  const [selection, setSelection] = useState<Choice[]>(() => selectionOf(quote));
  const [change, setChange] = useState<MoneyValue | null>(null);
  const [before, setBefore] = useState<Map<string, number> | null>(null);
  const latest = useRef(0);
  const customize = useMutation(trpc.quotes.customize.mutationOptions());

  function apply(next: Choice[]) {
    const request = ++latest.current;
    const previous = queryClient.getQueryData(key) ?? quote;
    setSelection(next);

    customize.mutate(
      { submissionId: submission.id, selection: next },
      {
        onSuccess: (updated) => {
          if (request !== latest.current) return;

          queryClient.setQueryData(key, updated);
          setBefore(premiumsOf(previous));

          setChange({
            amount: (
              Number(updated.premium.total.amount) - Number(previous.premium.total.amount)
            ).toFixed(2),
            currency: updated.currency,
          });
        },
        onError: () => {
          if (request === latest.current) setSelection(selectionOf(previous));
        },
      },
    );
  }

  const find = (coverage: string, exposure?: string | null) =>
    selection.find((c) => slot(c.coverage, c.exposure) === slot(coverage, exposure));

  function toggle(coverage: QuoteCoverage, exposure: string | null, on: boolean) {
    if (!on) {
      apply(
        selection.filter((c) => slot(c.coverage, c.exposure) !== slot(coverage.code, exposure)),
      );

      return;
    }

    apply([
      ...selection,
      {
        coverage: coverage.code,
        ...(exposure && { exposure }),
        ...(coverage.defaultLimit && { limit: coverage.defaultLimit }),
        ...(coverage.defaultDeductible && { deductible: coverage.defaultDeductible }),
      },
    ]);
  }

  function choose(
    coverage: string,
    exposure: string | null,
    field: "limit" | "deductible",
    value: CoverageAmount,
  ) {
    apply(
      selection.map((c) =>
        slot(c.coverage, c.exposure) === slot(coverage, exposure) ? { ...c, [field]: value } : c,
      ),
    );
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="grid gap-6">
        <Panel title="Coverages" description="Prices update as you change them." flush>
          <ul className="m-0 list-none divide-y p-0">
            {quote.coverages.map((coverage) => (
              <CoverageRow
                key={coverage.code}
                coverage={coverage}
                choiceFor={(exposure) => find(coverage.code, exposure)}
                before={before}
                onToggle={(exposure, on) => toggle(coverage, exposure, on)}
                onChoose={(exposure, field, value) => choose(coverage.code, exposure, field, value)}
              />
            ))}
          </ul>
        </Panel>
        <PayPlanPicker quote={quote} submissionId={submission.id} />
        {customize.error && (
          <Notice tone="error" title="Couldn't update the price">
            {customize.error.message}
          </Notice>
        )}
        <div className="flex justify-between gap-2">
          <Button variant="outline" onClick={() => go("quote")}>
            Back
          </Button>
          <Button onClick={() => go("details")} disabled={customize.isPending}>
            Continue to details <ArrowRight />
          </Button>
        </div>
      </div>
      <PremiumSummary quote={quote} change={change} busy={customize.isPending} />
    </div>
  );
}

function CoverageRow({
  coverage,
  choiceFor,
  before,
  onToggle,
  onChoose,
}: {
  coverage: QuoteCoverage;
  choiceFor: (exposure: string | null) => Choice | undefined;
  before: Map<string, number> | null;
  onToggle: (exposure: string | null, on: boolean) => void;
  onChoose: (exposure: string | null, field: "limit" | "deductible", value: CoverageAmount) => void;
}) {
  const single = coverage.exposures.length === 1;

  return (
    <li className="grid gap-4 px-(--card-p) py-4">
      {coverage.exposures.map((exposure) => {
        const choice = choiceFor(exposure.exposure);
        const selected = choice !== undefined;
        const id = `cov-${slot(coverage.code, exposure.exposure).replace(/\W/g, "-")}`;
        const now = Number(exposure.premium?.amount ?? 0);
        const was = before?.get(slot(coverage.code, exposure.exposure));
        const delta = was === undefined || !selected ? 0 : now - was;

        return (
          <div key={exposure.exposure ?? "policy"} className="grid gap-4">
            <div className="flex items-start gap-3">
              <Checkbox
                id={id}
                checked={selected}
                disabled={coverage.required}
                onCheckedChange={(on) => onToggle(exposure.exposure, on === true)}
                className="mt-0.5"
                aria-label={coverage.required ? `${coverage.name} is required` : coverage.name}
              />
              <div className="grid min-w-0 flex-1 gap-0.5">
                <Label htmlFor={id} className="leading-5">
                  {single ? coverage.name : exposure.label}
                </Label>
                <p className="m-0 text-xs text-muted-foreground">
                  {[
                    coverage.required && "Required",
                    single && exposure.label,
                    single && coverage.description,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <div className="grid shrink-0 gap-0.5 text-right">
                <span
                  className={cn(
                    "text-sm font-medium tabular-nums",
                    !selected && "text-muted-foreground",
                  )}
                >
                  {selected && exposure.premium ? formatMoney(exposure.premium) : "–"}
                </span>
                <span
                  className={cn(
                    "h-4 text-xs tabular-nums",
                    delta < 0 ? "text-emerald-700" : "text-muted-foreground",
                  )}
                >
                  {delta !== 0 &&
                    formatSignedMoney({
                      amount: delta.toFixed(2),
                      currency: exposure.premium!.currency,
                    })}
                </span>
              </div>
            </div>
            {selected && (coverage.limits.length > 0 || coverage.deductibles.length > 0) && (
              <div className="grid gap-4 pl-7 sm:grid-cols-2">
                <AmountChoice
                  label="Limit"
                  options={coverage.limits}
                  value={choice.limit ?? null}
                  onChange={(value) => onChoose(exposure.exposure, "limit", value)}
                />
                <AmountChoice
                  label="Deductible"
                  options={coverage.deductibles}
                  value={choice.deductible ?? null}
                  onChange={(value) => onChoose(exposure.exposure, "deductible", value)}
                />
              </div>
            )}
          </div>
        );
      })}
      {!single && <p className="m-0 -mt-2 pl-7 text-xs text-muted-foreground">{coverage.name}</p>}
    </li>
  );
}

function AmountChoice({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: CoverageAmount[];
  value: CoverageAmount | null;
  onChange: (value: CoverageAmount) => void;
}) {
  if (options.length === 0) return null;

  const current = options.find((o) => sameAmount(o, value)) ?? options[0]!;
  const byLabel = new Map(options.map((o) => [amountLabel(o), o]));

  return (
    <div className="grid content-start gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {options.length === 1 ? (
        <span className="text-sm tabular-nums">{amountLabel(current)}</span>
      ) : options.length <= 4 ? (
        <SegmentedControl
          label={label}
          value={amountLabel(current)}
          onValueChange={(next) => onChange(byLabel.get(next)!)}
          options={options.map((o) => ({
            value: amountLabel(o),
            label: <span className="tabular-nums">{amountLabel(o)}</span>,
          }))}
          className="w-fit"
        />
      ) : (
        <Select value={amountLabel(current)} onValueChange={(next) => onChange(byLabel.get(next)!)}>
          <SelectTrigger aria-label={label} className="tabular-nums">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={amountLabel(o)} value={amountLabel(o)}>
                {amountLabel(o)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
