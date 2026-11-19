import { Button } from "@pas/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@pas/ui/components/dialog";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@pas/ui/components/select";
import { useId, useState } from "react";
import { addDays } from "@/lib/format";
import {
  COUNTRIES,
  countryName,
  jurisdictionCode,
  jurisdictionName,
  subdivisionsOf,
} from "@pas/ui/lib/jurisdictions";
import type { AvailabilityWindow } from "./version-editor";

const WHOLE_COUNTRY = "*";

interface Draft {
  country: string;
  subdivision: string;
  newBusinessFrom: string;
  newBusinessLast: string;
  renewalFrom: string;
  renewalLast: string;
  market: "admitted" | "non_admitted";
}

function toDraft(window: AvailabilityWindow | undefined): Draft {
  if (!window) {
    return {
      country: "US",
      subdivision: "",
      newBusinessFrom: "",
      newBusinessLast: "",
      renewalFrom: "",
      renewalLast: "",
      market: "admitted",
    };
  }

  return {
    country: window.jurisdiction.country,
    subdivision: window.jurisdiction.subdivision ?? WHOLE_COUNTRY,
    newBusinessFrom: window.newBusiness.from,
    newBusinessLast: window.newBusiness.to ? addDays(window.newBusiness.to, -1) : "",
    renewalFrom: window.renewal.from,
    renewalLast: window.renewal.to ? addDays(window.renewal.to, -1) : "",
    market: window.market ?? "admitted",
  };
}

const toWindow = (from: string, last: string) => (last ? { from, to: addDays(last, 1) } : { from });

function fromDraft(draft: Draft): AvailabilityWindow {
  return {
    jurisdiction:
      draft.subdivision && draft.subdivision !== WHOLE_COUNTRY
        ? { country: draft.country, subdivision: draft.subdivision }
        : { country: draft.country },
    newBusiness: toWindow(draft.newBusinessFrom, draft.newBusinessLast),
    renewal: toWindow(draft.renewalFrom, draft.renewalLast),
    ...(draft.market === "non_admitted" && { market: draft.market }),
  };
}

type Errors = Partial<Record<keyof Draft, string>>;

function validate(draft: Draft, taken: readonly string[]): Errors {
  const errors: Errors = {};
  const hasSubdivisions = subdivisionsOf(draft.country).length > 0;

  if (hasSubdivisions && !draft.subdivision) errors.subdivision = "Choose a state";
  else if (taken.includes(jurisdictionCode(fromDraft(draft).jurisdiction))) {
    errors.subdivision = `${jurisdictionName(fromDraft(draft).jurisdiction)} is already listed`;
  }

  if (!draft.newBusinessFrom) errors.newBusinessFrom = "Choose the first effective date";

  if (draft.newBusinessLast && draft.newBusinessLast < draft.newBusinessFrom) {
    errors.newBusinessLast = "The last day is before the first";
  }

  if (!draft.renewalFrom) errors.renewalFrom = "Choose the first renewal date";

  if (draft.renewalLast && draft.renewalLast < draft.renewalFrom) {
    errors.renewalLast = "The last day is before the first";
  }

  return errors;
}

export function AvailabilityDialog({
  window,
  taken,
  open,
  onOpenChange,
  onSave,
  onRemove,
}: {
  window?: AvailabilityWindow;
  taken: readonly string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (window: AvailabilityWindow) => void;
  onRemove?: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open && (
          <AvailabilityForm
            window={window}
            taken={taken}
            onSave={(next) => {
              onSave(next);
              onOpenChange(false);
            }}
            onRemove={
              onRemove &&
              (() => {
                onRemove();
                onOpenChange(false);
              })
            }
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AvailabilityForm({
  window,
  taken,
  onSave,
  onRemove,
}: {
  window?: AvailabilityWindow;
  taken: readonly string[];
  onSave: (window: AvailabilityWindow) => void;
  onRemove?: () => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(() => toDraft(window));
  const [submitted, setSubmitted] = useState(false);
  const errors = submitted ? validate(draft, taken) : {};
  const subdivisions = subdivisionsOf(draft.country);
  const set = (changes: Partial<Draft>) => setDraft((current) => ({ ...current, ...changes }));

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);

    if (Object.keys(validate(draft, taken)).length === 0) onSave(fromDraft(draft));
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {window ? jurisdictionName(window.jurisdiction) : "Add jurisdiction"}
        </DialogTitle>
        <DialogDescription>
          Policies resolve to this version when their effective date falls in these windows.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={onSubmit} className="grid gap-6" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={`${id}-country`} label="Country">
            <Select
              value={draft.country}
              onValueChange={(country) => set({ country, subdivision: "" })}
            >
              <SelectTrigger id={`${id}-country`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COUNTRIES.map((code) => (
                  <SelectItem key={code} value={code}>
                    {countryName(code)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {subdivisions.length > 0 && (
            <Field id={`${id}-subdivision`} label="State" error={errors.subdivision}>
              <Select
                value={draft.subdivision}
                onValueChange={(subdivision) => set({ subdivision })}
              >
                <SelectTrigger id={`${id}-subdivision`} aria-invalid={!!errors.subdivision}>
                  <SelectValue placeholder="Choose a state" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value={WHOLE_COUNTRY}>All of {countryName(draft.country)}</SelectItem>
                  <SelectSeparator />
                  {subdivisions.map(([code, name]) => (
                    <SelectItem key={code} value={code}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field id={`${id}-market`} label="Market">
            <Select
              value={draft.market}
              onValueChange={(market) => set({ market: market as Draft["market"] })}
            >
              <SelectTrigger id={`${id}-market`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admitted">Admitted</SelectItem>
                <SelectItem value="non_admitted">Non-admitted (surplus lines)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>

        <fieldset className="m-0 grid gap-3 border-0 p-0">
          <legend className="mb-3 p-0 text-sm font-semibold">New business</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id={`${id}-nb-from`} label="First effective date" error={errors.newBusinessFrom}>
              <DateInput
                id={`${id}-nb-from`}
                value={draft.newBusinessFrom}
                invalid={!!errors.newBusinessFrom}
                onChange={(newBusinessFrom) =>
                  set({
                    newBusinessFrom,
                    ...((!draft.renewalFrom || draft.renewalFrom === draft.newBusinessFrom) && {
                      renewalFrom: newBusinessFrom,
                    }),
                  })
                }
              />
            </Field>
            <Field
              id={`${id}-nb-last`}
              label="Last effective date"
              optional
              error={errors.newBusinessLast}
            >
              <DateInput
                id={`${id}-nb-last`}
                value={draft.newBusinessLast}
                invalid={!!errors.newBusinessLast}
                onChange={(newBusinessLast) => set({ newBusinessLast })}
              />
            </Field>
          </div>
        </fieldset>

        <fieldset className="m-0 grid gap-3 border-0 p-0">
          <legend className="mb-3 p-0 text-sm font-semibold">Renewal</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id={`${id}-rn-from`} label="First effective date" error={errors.renewalFrom}>
              <DateInput
                id={`${id}-rn-from`}
                value={draft.renewalFrom}
                invalid={!!errors.renewalFrom}
                onChange={(renewalFrom) => set({ renewalFrom })}
              />
            </Field>
            <Field
              id={`${id}-rn-last`}
              label="Last effective date"
              optional
              error={errors.renewalLast}
            >
              <DateInput
                id={`${id}-rn-last`}
                value={draft.renewalLast}
                invalid={!!errors.renewalLast}
                onChange={(renewalLast) => set({ renewalLast })}
              />
            </Field>
          </div>
        </fieldset>

        <DialogFooter className="sm:justify-between">
          {onRemove ? (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={onRemove}
            >
              Remove
            </Button>
          ) : (
            <span />
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit">{window ? "Save changes" : "Add jurisdiction"}</Button>
          </div>
        </DialogFooter>
      </form>
    </>
  );
}

function Field({
  id,
  label,
  optional,
  error,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid content-start gap-2">
      <Label htmlFor={id}>
        {label}
        {optional && <span className="font-normal text-muted-foreground">Optional</span>}
      </Label>
      {children}
      {error && <p className="m-0 text-xs text-destructive">{error}</p>}
    </div>
  );
}

function DateInput({
  id,
  value,
  invalid,
  onChange,
}: {
  id: string;
  value: string;
  invalid?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Input
      id={id}
      type="date"
      value={value}
      aria-invalid={invalid}
      className="tabular-nums"
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
