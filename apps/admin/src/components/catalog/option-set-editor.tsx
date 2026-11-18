import { Button } from "@pas/ui/components/button";
import { Input } from "@pas/ui/components/input";
import { cn } from "@pas/ui/lib/utils";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { formatMoney } from "@/lib/format";
import type { Coverage } from "./version-editor";

export type OptionSet = NonNullable<Coverage["limitOptions"]>;
export type Amount = OptionSet["options"][number];

export function formatAmount(amount: Amount): string {
  return amount.kind === "money"
    ? formatMoney(amount.amount, amount.currency)
    : `${Number(amount.value).toLocaleString()}%`;
}

function parseAmount(text: string, currency: string): Amount | null {
  const cleaned = text.replace(/[\s,$]/g, "");
  const percent = cleaned.endsWith("%");
  const value = percent ? cleaned.slice(0, -1) : cleaned;

  if (!/^\d+(\.\d+)?$/.test(value)) return null;

  return percent ? { kind: "percent", value } : { kind: "money", amount: value, currency };
}

const sameAmount = (a: Amount, b: Amount) => formatAmount(a) === formatAmount(b);

export function OptionSetEditor({
  id,
  noun,
  value,
  currency,
  readOnly,
  onChange,
}: {
  id: string;
  noun: string;
  value: OptionSet | undefined;
  currency: string;
  readOnly: boolean;
  onChange: (next: OptionSet | undefined) => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  function add() {
    const amount = parseAmount(text, currency);

    if (!amount) {
      setError(`Enter an amount like 300,000 or a percentage like 2%`);

      return;
    }

    const options = value?.options ?? [];

    if (options.some((option) => sameAmount(option, amount))) {
      setError(`${formatAmount(amount)} is already an option`);

      return;
    }

    onChange({ options: [...options, amount], defaultIndex: value?.defaultIndex ?? 0 });
    setText("");
    setError(null);
  }

  function remove(index: number) {
    if (!value) return;

    const options = value.options.filter((_, i) => i !== index);

    if (options.length === 0) return onChange(undefined);

    const defaultIndex =
      index === value.defaultIndex ? 0 : value.defaultIndex - (index < value.defaultIndex ? 1 : 0);

    onChange({ options, defaultIndex });
  }

  const options = value?.options ?? [];

  return (
    <div className="grid gap-2">
      {options.length > 0 ? (
        <ul
          role="radiogroup"
          aria-label={`Default ${noun}`}
          className="m-0 grid list-none divide-y rounded-lg border p-0"
        >
          {options.map((option, i) => {
            const isDefault = i === value?.defaultIndex;

            return (
              <li key={formatAmount(option)} className="flex h-10 items-center gap-3 pr-1.5 pl-3">
                <span className="flex-1 text-sm tabular-nums">{formatAmount(option)}</span>
                {isDefault ? (
                  <span className="text-xs font-medium text-primary">Default</span>
                ) : (
                  !readOnly && (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={false}
                      onClick={() => onChange({ options, defaultIndex: i })}
                      className="rounded text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground"
                    >
                      Make default
                    </button>
                  )
                )}
                {!readOnly && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground"
                    aria-label={`Remove ${formatAmount(option)}`}
                    onClick={() => remove(i)}
                  >
                    <X />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        readOnly && <p className="m-0 text-sm text-muted-foreground">No {noun} options</p>
      )}
      {!readOnly && (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <Input
            id={id}
            value={text}
            aria-invalid={!!error}
            placeholder={options.length ? `Add a ${noun}` : `Add a ${noun}, like 300,000 or 2%`}
            className={cn("h-8 tabular-nums")}
            onChange={(event) => {
              setText(event.target.value);
              setError(null);
            }}
          />
          <Button type="submit" variant="outline" size="sm" disabled={!text.trim()}>
            <Plus /> Add
          </Button>
        </form>
      )}
      {error && <p className="m-0 text-xs text-destructive">{error}</p>}
    </div>
  );
}
