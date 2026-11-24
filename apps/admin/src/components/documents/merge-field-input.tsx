import { contextSchema, hasUnclosedField, mergeFields } from "@pas/documents";
import {
  canonicalPath,
  indexSchema,
  isField,
  type RiskSchema,
  resolvesInSchema,
  type SchemaIndex,
  type SchemaNode,
} from "@pas/forms-core";
import { Button } from "@pas/ui/components/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@pas/ui/components/command";
import { Input } from "@pas/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@pas/ui/components/popover";
import { Textarea } from "@pas/ui/components/textarea";
import { cn } from "@pas/ui/lib/utils";
import { Braces } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Code } from "@/components/builders/inspector";
import { KIND_META } from "@/components/builders/kinds";
import { useDocumentFields } from "./document-fields";

interface MergeOption {
  path: string;
  label: string;
  group: string;
  kind: keyof typeof KIND_META;
}

const HIDDEN_ROOTS = new Set(["jurisdiction", "country", "transaction", "coverages"]);

export function mergeOptions(risk: RiskSchema, extra: readonly SchemaNode[] = []): MergeOption[] {
  const index = indexSchema(contextSchema(risk, "document", extra));
  const options: MergeOption[] = [];

  for (const [path, node] of index) {
    if (!isField(node) || HIDDEN_ROOTS.has(path)) continue;

    const repeat = path.indexOf("[]");

    if (repeat >= 0 && path.indexOf("[]", repeat + 2) >= 0) continue;

    const parentPath = path.slice(0, path.lastIndexOf(".")).replace(/\[\]$/, "");
    const parent = index.get(parentPath);
    const first = repeat >= 0 ? `First ${parent?.label.toLowerCase() ?? "entry"}` : undefined;

    options.push({
      path: path.replace("[]", "[0]"),
      label: node.label,
      group: first ?? parent?.label ?? "General",
      kind: node.kind as keyof typeof KIND_META,
    });
  }

  return options;
}

export function unresolvedFields(index: SchemaIndex, text: string): string[] {
  return mergeFields(text)
    .map((field) => field.path)
    .filter((path) => !path || !resolvesInSchema(index, canonicalPath(path)));
}

export function MergeFieldInput({
  id,
  value,
  onChange,
  schema,
  multiline,
  placeholder,
  rows,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  schema: RiskSchema;
  multiline?: boolean;
  placeholder?: string;
  rows?: number;
}) {
  const [open, setOpen] = useState(false);
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const caret = useRef<[number, number]>([value.length, value.length]);
  const extra = useDocumentFields();
  const options = useMemo(() => mergeOptions(schema, extra), [schema, extra]);

  const index = useMemo(
    () => indexSchema(contextSchema(schema, "document", extra)),
    [schema, extra],
  );

  const unknown = useMemo(() => unresolvedFields(index, value), [index, value]);
  const unclosed = hasUnclosedField(value);

  const groups = useMemo(() => {
    const map = new Map<string, MergeOption[]>();

    for (const option of options) map.set(option.group, [...(map.get(option.group) ?? []), option]);

    return [...map];
  }, [options]);

  const remember = (target: HTMLInputElement | HTMLTextAreaElement) => {
    caret.current = [target.selectionStart ?? value.length, target.selectionEnd ?? value.length];
  };

  const insert = (path: string) => {
    const [start, end] = caret.current;
    const token = `{{${path}}}`;
    const next = value.slice(0, start) + token + value.slice(end);
    const position = start + token.length;
    onChange(next);
    setOpen(false);
    caret.current = [position, position];

    requestAnimationFrame(() => {
      field.current?.focus();
      field.current?.setSelectionRange(position, position);
    });
  };

  const shared = {
    id,
    ref: field,
    value,
    placeholder,
    spellCheck: !multiline ? false : undefined,
    "aria-invalid": unclosed || undefined,
    onChange: (event: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => {
      onChange(event.target.value);
      remember(event.target);
    },
    onSelect: (event: React.SyntheticEvent<HTMLInputElement & HTMLTextAreaElement>) =>
      remember(event.currentTarget),
  };

  return (
    <div className="grid gap-2">
      <div className="relative">
        {multiline ? (
          <Textarea {...shared} rows={rows ?? 4} className="min-h-24 pr-10 leading-6" />
        ) : (
          <Input {...shared} className="pr-10" />
        )}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Insert a merge field"
              title="Insert a merge field"
              className={cn(
                "absolute right-1 size-7 text-muted-foreground hover:text-foreground",
                multiline ? "top-1" : "top-1/2 -translate-y-1/2",
              )}
            >
              <Braces />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-0">
            <Command>
              <CommandInput placeholder="Search fields" className="h-10" />
              <CommandList className="max-h-80 p-1">
                <CommandEmpty>No fields match.</CommandEmpty>
                {groups.map(([heading, list]) => (
                  <CommandGroup key={heading} heading={heading}>
                    {list.map((option) => {
                      const Icon = KIND_META[option.kind]?.icon;

                      return (
                        <CommandItem
                          key={option.path}
                          value={`${heading} ${option.label} ${option.path}`}
                          onSelect={() => insert(option.path)}
                        >
                          {Icon && <Icon />}
                          <span className="truncate">{option.label}</span>
                          <Code className="ml-auto truncate pl-2 text-xs text-muted-foreground">
                            {option.path}
                          </Code>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
      {unclosed ? (
        <p className="m-0 text-sm text-destructive">
          A merge field is missing {"{{"} or {"}}"}.
        </p>
      ) : (
        unknown.length > 0 && (
          <p className="m-0 flex items-center gap-2 text-sm text-amber-900">
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-amber-500" />
            <span>
              <Code className="text-amber-900">{unknown[0] || "{{}}"}</Code> doesn't resolve
              {unknown.length > 1 && ` (and ${unknown.length - 1} more)`}.
            </span>
          </p>
        )
      )}
    </div>
  );
}
