import type { Operand } from "@pas/rating-engine/plan";
import { Button } from "@pas/ui/components/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@pas/ui/components/command";
import { Popover, PopoverContent, PopoverTrigger } from "@pas/ui/components/popover";
import { cn } from "@pas/ui/lib/utils";
import { Check, ChevronsUpDown, Hash } from "lucide-react";
import { useMemo, useState } from "react";
import { describeOperand, type OperandOption, operandKey } from "./model";

const NUMBER = /^-?\d+(\.\d+)?$/;

export function OperandPicker({
  id,
  value,
  options,
  placeholder = "Choose a value",
  invalid,
  disabled,
  onChange,
}: {
  id?: string;
  value: Operand | undefined;
  options: readonly OperandOption[];
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  onChange: (operand: Operand) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const current = value ? describeOperand(value, options) : undefined;
  const selected = value ? operandKey(value) : undefined;

  const groups = useMemo(() => {
    const map = new Map<string, OperandOption[]>();

    for (const option of options) map.set(option.group, [...(map.get(option.group) ?? []), option]);

    return [...map];
  }, [options]);

  const literal = search.trim();

  const constant =
    NUMBER.test(literal) || literal === "true" || literal === "false"
      ? NUMBER.test(literal)
        ? Number(literal)
        : literal === "true"
      : literal.startsWith('"') && literal.length > 1
        ? literal.replace(/^"|"$/g, "")
        : undefined;

  const pick = (operand: Operand) => {
    onChange(operand);
    setOpen(false);
    setSearch("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          disabled={disabled}
          aria-expanded={open}
          aria-invalid={invalid}
          className={cn(
            "w-full min-w-0 justify-between px-3 font-normal aria-invalid:border-destructive",
            !current && "text-muted-foreground",
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            {value && "value" in value && <Hash className="text-muted-foreground" />}
            {current ? (
              <>
                <span className="max-w-full shrink-0 truncate tabular-nums">{current.label}</span>
                {current.detail && (
                  <code className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                    {current.detail}
                  </code>
                )}
              </>
            ) : (
              placeholder
            )}
          </span>
          <ChevronsUpDown className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-80 p-0" align="start">
        <Command>
          <CommandInput
            placeholder="Search, or type a number"
            className="h-10"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList className="max-h-80 p-1">
            <CommandEmpty>Nothing matches.</CommandEmpty>
            {constant !== undefined && (
              <CommandGroup heading="Constant">
                <CommandItem
                  value={`constant ${literal}`}
                  onSelect={() => pick({ value: constant })}
                >
                  <Hash />
                  Use <span className="font-medium tabular-nums">{String(constant)}</span>
                </CommandItem>
              </CommandGroup>
            )}
            {groups.map(([heading, list]) => (
              <CommandGroup key={heading} heading={heading}>
                {list.map((option) => {
                  const key = operandKey(option.operand);

                  return (
                    <CommandItem
                      key={key}
                      value={`${option.label} ${option.detail}`}
                      onSelect={() => pick(option.operand)}
                    >
                      <span className="truncate">{option.label}</span>
                      <code className="ml-auto truncate pl-2 font-mono text-xs text-muted-foreground">
                        {option.detail}
                      </code>
                      <Check
                        className={cn("size-4", key === selected ? "text-primary!" : "invisible")}
                      />
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
