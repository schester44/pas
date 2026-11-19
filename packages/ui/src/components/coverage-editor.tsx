import { cn } from "../lib/utils";
import { amountLabel, type CoverageAmount, exposureLabel, sameAmount } from "../lib/policy-change";
import { Checkbox } from "./checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";

export interface CoverageOfferLike {
  code: string;
  name: string;
  description?: string;
  required: boolean;
  dependsOn: string[];
  attachesTo: { level: "policy" } | { level: "exposure"; path: string };
  limits: CoverageAmount[];
  deductibles: CoverageAmount[];
}

export interface CoverageChoiceLike {
  coverage: string;
  exposure?: string;
  limit?: CoverageAmount;
  deductible?: CoverageAmount;
}

const keyOf = (amount: CoverageAmount) =>
  amount.kind === "money" ? amount.amount : `${amount.value}%`;

function AmountSelect({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: CoverageAmount[];
  value?: CoverageAmount;
  onChange: (value: CoverageAmount) => void;
  disabled?: boolean;
}) {
  if (options.length === 0) return <span className="text-sm text-muted-foreground">–</span>;

  return (
    <Select
      value={value ? keyOf(value) : undefined}
      onValueChange={(key) => onChange(options.find((o) => keyOf(o) === key)!)}
      disabled={disabled}
    >
      <SelectTrigger aria-label={label} className="h-8 w-full tabular-nums">
        <SelectValue placeholder="Choose" />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={keyOf(option)} value={keyOf(option)} className="tabular-nums">
            {amountLabel(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Coverages, limits and deductibles within what the release offers. Changed rows are tinted. */
function CoverageEditor({
  offers,
  exposures,
  value,
  original,
  onChange,
  labels,
}: {
  offers: CoverageOfferLike[];
  exposures: Record<string, string[]>;
  value: CoverageChoiceLike[];
  original: CoverageChoiceLike[];
  onChange: (value: CoverageChoiceLike[]) => void;
  labels?: Record<string, string>;
}) {
  const slots = offers.flatMap((offer) =>
    offer.attachesTo.level === "policy"
      ? [{ offer, exposure: undefined as string | undefined }]
      : (exposures[offer.attachesTo.path] ?? []).map((exposure) => ({ offer, exposure })),
  );

  const find = (list: CoverageChoiceLike[], code: string, exposure?: string) =>
    list.find((c) => c.coverage === code && c.exposure === exposure);

  const update = (
    code: string,
    exposure: string | undefined,
    patch: Partial<CoverageChoiceLike> | null,
  ) => {
    const others = value.filter((c) => !(c.coverage === code && c.exposure === exposure));

    if (patch === null) return onChange(others);

    const current = find(value, code, exposure) ?? {
      coverage: code,
      ...(exposure && { exposure }),
    };

    onChange([...others, { ...current, ...patch }]);
  };

  return (
    <ul className="m-0 grid list-none divide-y p-0">
      {slots.map(({ offer, exposure }) => {
        const choice = find(value, offer.code, exposure);
        const was = find(original, offer.code, exposure);
        const selected = !!choice;

        const changed =
          selected !== !!was ||
          (choice &&
            was &&
            (!sameAmount(choice.limit, was.limit) ||
              !sameAmount(choice.deductible, was.deductible)));

        const id = `cov-${offer.code}-${exposure ?? "policy"}`;

        return (
          <li
            key={id}
            className={cn(
              "grid gap-3 px-(--card-p) py-3 sm:grid-cols-[minmax(0,1fr)_9rem_9rem] sm:items-center",
              changed && "bg-primary/5",
            )}
          >
            <div className="flex items-start gap-3">
              <Checkbox
                id={id}
                checked={selected}
                disabled={offer.required}
                className="mt-0.5"
                onCheckedChange={(checked) =>
                  update(
                    offer.code,
                    exposure,
                    checked
                      ? {
                          ...(offer.limits[0] && { limit: offer.limits[0] }),
                          ...(offer.deductibles[0] && { deductible: offer.deductibles[0] }),
                        }
                      : null,
                  )
                }
              />
              <label htmlFor={id} className="grid min-w-0 gap-0.5">
                <span className="text-sm font-medium">{offer.name}</span>
                <span className="text-xs text-muted-foreground">
                  {[exposureLabel(exposure, labels) ?? "Policy", offer.required ? "Required" : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </label>
            </div>
            <AmountSelect
              label={`${offer.name} limit`}
              options={offer.limits}
              value={choice?.limit}
              disabled={!selected}
              onChange={(limit) => update(offer.code, exposure, { limit })}
            />
            <AmountSelect
              label={`${offer.name} deductible`}
              options={offer.deductibles}
              value={choice?.deductible}
              disabled={!selected}
              onChange={(deductible) => update(offer.code, exposure, { deductible })}
            />
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Keeps a selection in step with the exposures being edited: required coverages for entries
 * just added, nothing for entries removed.
 */
function withExposures(
  value: CoverageChoiceLike[],
  offers: CoverageOfferLike[],
  exposures: Record<string, string[]>,
): CoverageChoiceLike[] {
  const live = new Set(Object.values(exposures).flat());
  const kept = value.filter((c) => c.exposure === undefined || live.has(c.exposure));

  const added = offers.flatMap((offer) =>
    offer.attachesTo.level === "exposure" && offer.required
      ? (exposures[offer.attachesTo.path] ?? [])
          .filter(
            (exposure) => !kept.some((c) => c.coverage === offer.code && c.exposure === exposure),
          )
          .map((exposure) => ({
            coverage: offer.code,
            exposure,
            ...(offer.limits[0] && { limit: offer.limits[0] }),
            ...(offer.deductibles[0] && { deductible: offer.deductibles[0] }),
          }))
      : [],
  );

  return added.length === 0 && kept.length === value.length ? value : [...kept, ...added];
}

export { CoverageEditor, withExposures };
