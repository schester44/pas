import type { AddressValue } from "@pas/forms-core";
import { Button } from "@pas/ui/components/button";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { Spinner } from "@pas/ui/components/spinner";
import { cn } from "@pas/ui/lib/utils";
import { CircleCheck, MapPin } from "lucide-react";
import type * as React from "react";
import { createContext, useContext, useEffect, useId, useRef, useState } from "react";
import { type Copy, defaultCopy } from "./copy";

export interface AddressSuggestion {
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  entries?: number;
  selected?: string;
}

export interface AddressCheck {
  value: AddressValue;
  status: "verified" | "unverified";
  notes: string[];
  county: string | null;
}

/** Server-side autocomplete and verification; without it, addresses are plain fields. */
export interface AddressLookup {
  suggest(text: string, selected?: string): Promise<AddressSuggestion[]>;
  verify(address: AddressValue): Promise<AddressCheck>;
}

const AddressLookupContext = createContext<AddressLookup | null>(null);

export const AddressLookupProvider = AddressLookupContext.Provider;

export const useAddressLookup = () => useContext(AddressLookupContext);

type Part = "line1" | "line2" | "city" | "region" | "postalCode" | "country";

const PARTS: readonly Part[] = ["line1", "line2", "city", "region", "postalCode", "country"];

const complete = (a: Partial<AddressValue>) =>
  Boolean(a.line1?.trim() && a.city?.trim() && a.region?.trim() && a.postalCode?.trim());

const placeLine = (s: { city: string; region: string; postalCode: string }) =>
  `${s.city}, ${s.region} ${s.postalCode}`.trim();

export interface AddressFieldProps {
  id: string;
  value: Partial<AddressValue> | null | undefined;
  onChange: (value: AddressValue | undefined) => void;
  /** A fixed country hides the country input. */
  country?: string;
  invalid?: boolean;
  describedBy?: string;
  copy?: Copy["address"];
}

type Check =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "unverified"; result: AddressCheck }
  | { state: "verified"; notes: string[]; county: string | null };

/**
 * An address as one control (PLAN §15.9): the street line is a combobox of suggestions; picking
 * one verifies it on the server and fills the standardized parts. Typed addresses are checked
 * when focus leaves the group and can be kept as entered, flagged as unverified.
 */
export function AddressField(props: AddressFieldProps) {
  const lookup = useAddressLookup();
  const { id, value, onChange, country, invalid, describedBy } = props;
  const copy = props.copy ?? defaultCopy.address;
  const address = { ...value } as Partial<AddressValue>;
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [units, setUnits] = useState<string | null>(null);
  const [check, setCheck] = useState<Check>({ state: "idle" });
  const [typed, setTyped] = useState<{ text: string; at: number } | null>(null);
  const latest = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  const emit = (next: Partial<AddressValue>) => {
    const filled = PARTS.some((part) => part !== "country" && next[part]);

    onChange(filled ? ({ ...next, ...(country && { country }) } as AddressValue) : undefined);
  };

  const edit = (part: Part, text: string) => {
    const { addressId: _id, verified: _verified, ...rest } = address;
    setCheck({ state: "idle" });
    emit({ ...rest, [part]: text });

    if (part !== "line1") return;

    if (text.trim().length < 3) {
      latest.current++;
      setSuggestions([]);
      setOpen(false);
    } else {
      setTyped({ text, at: Date.now() });
    }
  };

  useEffect(() => {
    if (!lookup || !typed) return;

    const text = typed.text.trim();
    const request = ++latest.current;

    const timer = setTimeout(() => {
      if (request !== latest.current) return;

      setLoading(true);

      lookup
        .suggest(text)
        .then((found) => {
          if (request !== latest.current) return;

          setUnits(null);
          setSuggestions(found);
          setActive(-1);
          setOpen(found.length > 0 && document.activeElement === input.current);
        })
        .catch(() => setSuggestions([]))
        .finally(() => request === latest.current && setLoading(false));
    }, 250);

    return () => clearTimeout(timer);
  }, [lookup, typed]);

  const verify = async (candidate: Partial<AddressValue>) => {
    if (!lookup || !complete(candidate)) return;

    setCheck({ state: "checking" });

    try {
      const result = await lookup.verify({
        country: country ?? "US",
        ...candidate,
      } as AddressValue);

      if (result.status === "verified") {
        emit(result.value);
        setCheck({ state: "verified", notes: result.notes, county: result.county });
      } else {
        setCheck({ state: "unverified", result });
      }
    } catch {
      setCheck({ state: "idle" });
    }
  };

  const choose = async (suggestion: AddressSuggestion) => {
    if (suggestion.entries && suggestion.selected && lookup) {
      setLoading(true);

      const found = await lookup
        .suggest(suggestion.line1, suggestion.selected)
        .finally(() => setLoading(false));

      setUnits(suggestion.line1);
      setSuggestions(found);
      setActive(0);

      return;
    }

    setOpen(false);
    setSuggestions([]);

    const picked = {
      line1: suggestion.line1,
      ...(suggestion.line2 ? { line2: suggestion.line2 } : {}),
      city: suggestion.city,
      region: suggestion.region,
      postalCode: suggestion.postalCode,
      country: suggestion.country,
    };

    emit(picked);
    await verify(picked);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) {
      if (event.key === "ArrowDown" && suggestions.length > 0) setOpen(true);

      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (event.key === "Enter" && active >= 0) {
      event.preventDefault();
      void choose(suggestions[active]!);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  };

  const onBlurGroup = (event: React.FocusEvent) => {
    if (root.current?.contains(event.relatedTarget as Node | null)) return;

    latest.current++;
    setLoading(false);
    setOpen(false);

    if (check.state === "idle" && !address.addressId && complete(address)) void verify(address);
  };

  const field = (part: Part, className: string, autoComplete: string, extra?: React.ReactNode) => (
    <div className={cn("relative grid gap-1.5", className)}>
      <Label
        htmlFor={part === "line1" ? id : `${id}-${part}`}
        className="text-xs text-muted-foreground"
      >
        {copy[part]}
      </Label>
      {part === "line1" ? (
        <div className="relative">
          <Input
            ref={input}
            id={id}
            role={lookup ? "combobox" : undefined}
            aria-autocomplete={lookup ? "list" : undefined}
            aria-expanded={lookup ? open : undefined}
            aria-controls={lookup ? listId : undefined}
            aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
            aria-invalid={(invalid && !address.line1) || undefined}
            aria-describedby={describedBy}
            autoComplete={lookup ? "off" : autoComplete}
            placeholder={lookup ? "Start typing an address" : undefined}
            value={address.line1 ?? ""}
            onChange={(event) => edit("line1", event.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => suggestions.length > 0 && !address.addressId && setOpen(true)}
            className={cn(lookup && "pr-9")}
          />
          {lookup && (
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground">
              {loading ? <Spinner /> : <MapPin aria-hidden className="size-4" />}
            </span>
          )}
        </div>
      ) : (
        <Input
          id={`${id}-${part}`}
          aria-invalid={(invalid && part !== "line2" && !address[part]) || undefined}
          aria-describedby={describedBy}
          autoComplete={autoComplete}
          inputMode={part === "postalCode" ? "numeric" : undefined}
          className={cn(part === "postalCode" && "tabular-nums")}
          value={address[part] ?? ""}
          onChange={(event) => edit(part, event.target.value)}
        />
      )}
      {extra}
    </div>
  );

  const listbox = open && suggestions.length > 0 && (
    <ul
      id={listId}
      role="listbox"
      aria-label={units ? `Units at ${units}` : "Address suggestions"}
      className="absolute inset-x-0 top-full z-50 m-0 mt-1.5 max-h-72 list-none overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
    >
      {suggestions.map((s, i) => (
        <li
          key={`${s.line1}|${s.line2 ?? ""}|${s.postalCode}|${i}`}
          id={`${listId}-${i}`}
          role="option"
          aria-selected={i === active}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void choose(s)}
          onMouseEnter={() => setActive(i)}
          className={cn(
            "flex cursor-pointer items-baseline justify-between gap-3 rounded-md px-2.5 py-2 text-sm",
            i === active && "bg-muted",
          )}
        >
          <span className="grid min-w-0 gap-0.5">
            <span className="truncate font-medium">
              {[s.line1, s.line2].filter(Boolean).join(" ")}
            </span>
            <span className="truncate text-xs text-muted-foreground tabular-nums">
              {placeLine(s)}
            </span>
          </span>
          {s.entries ? (
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {s.entries} units
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );

  return (
    <div ref={root} className="@container grid gap-3" onBlur={onBlurGroup}>
      <div className="grid gap-3 @lg:grid-cols-6">
        {field("line1", "@lg:col-span-4", "address-line1", listbox)}
        {field("line2", "@lg:col-span-2", "address-line2")}
        {field("city", "@lg:col-span-2", "address-level2")}
        {field("region", "@lg:col-span-2", "address-level1")}
        {field("postalCode", "@lg:col-span-2", "postal-code")}
        {!country && field("country", "@lg:col-span-2", "country")}
      </div>
      {lookup && (
        <AddressStatus
          check={check}
          address={address}
          onUseAsEntered={(result) => {
            emit(result.value);
            setCheck({ state: "idle" });
          }}
        />
      )}
    </div>
  );
}

function AddressStatus({
  check,
  address,
  onUseAsEntered,
}: {
  check: Check;
  address: Partial<AddressValue>;
  onUseAsEntered: (result: AddressCheck) => void;
}) {
  if (check.state === "checking") {
    return (
      <p role="status" className="m-0 flex items-center gap-2 text-xs text-muted-foreground">
        <Spinner /> Checking the address
      </p>
    );
  }

  if (check.state === "unverified") {
    return (
      <div
        role="status"
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
      >
        <span className="flex items-center gap-2">
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-amber-500" />
          We couldn't verify this address. Check it, or use it as entered.
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="bg-card"
          onClick={() => onUseAsEntered(check.result)}
        >
          Use as entered
        </Button>
      </div>
    );
  }

  if (address.addressId && address.verified) {
    const notes = check.state === "verified" ? check.notes : [];
    const county = check.state === "verified" ? check.county : null;

    return (
      <p
        role="status"
        className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
      >
        <CircleCheck aria-hidden className="size-3.5 text-emerald-600" />
        <span>Verified address{county ? ` · ${county} County` : ""}</span>
        {notes.map((note) => (
          <span key={note} className="text-amber-800">
            · {note}
          </span>
        ))}
      </p>
    );
  }

  if (address.addressId && address.verified === false) {
    return (
      <p role="status" className="m-0 flex items-center gap-2 text-xs text-muted-foreground">
        <span aria-hidden className="size-1.5 rounded-full bg-amber-500" />
        Not verified; used as entered
      </p>
    );
  }

  return null;
}
