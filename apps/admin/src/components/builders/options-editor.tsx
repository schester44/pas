import type { EnumOption } from "@pas/forms-core";
import { Button } from "@pas/ui/components/button";
import { Input } from "@pas/ui/components/input";
import { Plus, X } from "lucide-react";
import { Code, IconAction } from "./inspector";

const toValue = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

export function OptionsEditor({
  options,
  onChange,
  readOnly,
  error,
}: {
  options: EnumOption[];
  onChange: (options: EnumOption[]) => void;
  readOnly?: boolean;
  error?: string;
}) {
  if (readOnly) {
    return (
      <ul className="m-0 grid list-none divide-y rounded-lg border p-0">
        {options.map((option) => (
          <li
            key={option.value}
            className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm"
          >
            <span>{option.label}</span>
            <Code className="text-muted-foreground">{option.value}</Code>
          </li>
        ))}
      </ul>
    );
  }

  const update = (index: number, patch: Partial<EnumOption>) =>
    onChange(options.map((option, i) => (i === index ? { ...option, ...patch } : option)));

  return (
    <div className="grid gap-2">
      {options.length > 0 && (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] gap-2 text-xs text-muted-foreground">
          <span>Label</span>
          <span>Value</span>
        </div>
      )}
      {options.map((option, index) => (
        <div
          key={index}
          className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] items-center gap-2"
        >
          <Input
            aria-label={`Option ${index + 1} label`}
            value={option.label}
            className="h-8"
            onChange={(event) => {
              const label = event.target.value;
              const synced = !option.value || option.value === toValue(option.label);
              update(index, synced ? { label, value: toValue(label) } : { label });
            }}
          />
          <Input
            aria-label={`Option ${index + 1} value`}
            value={option.value}
            className="h-8 font-mono text-[0.8125rem]"
            onChange={(event) => update(index, { value: event.target.value })}
          />
          <IconAction
            label={`Remove ${option.label || "option"}`}
            icon={X}
            onClick={() => onChange(options.filter((_, i) => i !== index))}
          />
        </div>
      ))}
      {error && <p className="m-0 text-sm text-destructive">{error}</p>}
      <div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-ml-2.5 text-muted-foreground"
          onClick={() => onChange([...options, { label: "", value: "" }])}
        >
          <Plus /> Add option
        </Button>
      </div>
    </div>
  );
}
