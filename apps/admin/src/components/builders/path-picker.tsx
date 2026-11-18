import type { RiskSchema } from "@pas/forms-core";
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
import { Check, ChevronsUpDown } from "lucide-react";
import { useMemo, useState } from "react";
import { type Bindable, bindableFields, fieldFor } from "./form-tree";
import { Code } from "./inspector";
import { KIND_META } from "./kinds";

export function PathPicker({
  id,
  schema,
  repeat,
  value,
  bound,
  invalid,
  onChange,
}: {
  id?: string;
  schema: RiskSchema;
  repeat?: string;
  value: string;
  bound: ReadonlySet<string>;
  invalid?: boolean;
  onChange: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const fields = useMemo(() => bindableFields(schema, repeat), [schema, repeat]);

  const groups = useMemo(() => {
    const map = new Map<string, Bindable[]>();

    for (const field of fields) {
      const heading = field.group || (repeat ? "Each entry" : "Top level");
      map.set(heading, [...(map.get(heading) ?? []), field]);
    }

    return [...map];
  }, [fields, repeat]);

  const current = value ? fieldFor(schema, value, repeat) : undefined;
  const Icon = current ? KIND_META[current.kind].icon : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid}
          className={cn(
            "w-full justify-between px-3 font-normal aria-invalid:border-destructive",
            !value && "text-muted-foreground",
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            {Icon && <Icon className="text-muted-foreground" />}
            {current ? (
              <>
                <span className="truncate">{current.label}</span>
                <Code className="truncate text-muted-foreground">{value}</Code>
              </>
            ) : value ? (
              <Code className="truncate">{value}</Code>
            ) : (
              "Choose a field"
            )}
          </span>
          <ChevronsUpDown className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-80 p-0">
        <Command>
          <CommandInput placeholder="Search fields" className="h-10" />
          <CommandList className="max-h-80 p-1">
            <CommandEmpty>No fields match.</CommandEmpty>
            {groups.map(([heading, list]) => (
              <CommandGroup key={heading} heading={heading}>
                {list.map((field) => {
                  const FieldIcon = KIND_META[field.node.kind].icon;
                  const taken = bound.has(field.path) && field.path !== value;

                  return (
                    <CommandItem
                      key={field.path}
                      value={`${field.node.label} ${field.path}`}
                      disabled={taken}
                      onSelect={() => {
                        onChange(field.path);
                        setOpen(false);
                      }}
                    >
                      <FieldIcon />
                      <span className="truncate">{field.node.label}</span>
                      <Code className="ml-auto truncate pl-2 text-xs text-muted-foreground">
                        {field.path}
                      </Code>
                      <Check
                        className={cn(
                          "size-4",
                          field.path === value ? "text-primary!" : "invisible",
                        )}
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
