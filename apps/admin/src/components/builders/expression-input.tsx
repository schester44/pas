import { referencedPaths, validate } from "@pas/expressions";
import { type RiskSchema, resolvesInSchema, schemaIndex } from "@pas/forms-core";
import { useExpressionsReady } from "@pas/forms-react";
import { Input } from "@pas/ui/components/input";
import { cn } from "@pas/ui/lib/utils";
import type * as React from "react";
import { useId, useMemo, useRef, useState } from "react";
import { expressionSuggestions, type Suggestion } from "./form-tree";
import { Code } from "./inspector";
import { KIND_META } from "./kinds";

type Analysis =
  | { status: "empty" | "pending" }
  | { status: "syntax"; message: string }
  | { status: "ok"; unknown: string[]; reads: string[] };

const FRIENDLY: [RegExp, string][] = [
  [/^Unexpected end/, "The expression ends too early."],
  [/^Incomplete parser output/, "The expression is incomplete."],
  [/^Unexpected EOF/, "A quote or bracket isn't closed."],
  [/^Expected a literal/, "Something is missing after an operator."],
];

export function friendly(message: string) {
  return FRIENDLY.find(([pattern]) => pattern.test(message))?.[1] ?? `${message}.`;
}

function analyze(schema: RiskSchema, expression: string, repeat?: string): Analysis {
  if (!expression.trim()) return { status: "empty" };

  const check = validate(expression);

  if (!check.ok) return { status: "syntax", message: friendly(check.message) };

  let paths: string[];

  try {
    paths = referencedPaths(expression, {
      aliases: repeat ? { $item: `${repeat}[]`, $index: null } : {},
    });
  } catch (error) {
    return { status: "syntax", message: friendly((error as Error).message) };
  }

  const index = schemaIndex(schema);
  const unknown = paths.filter((path) => !resolvesInSchema(index, path));

  const asWritten = (path: string) =>
    repeat && path.startsWith(`${repeat}[].`) ? `$item.${path.slice(repeat.length + 3)}` : path;

  const reads = paths.flatMap((path) => {
    const node = index.get(path);

    return node && !unknown.includes(path) ? [node.label] : [];
  });

  return { status: "ok", unknown: unknown.map(asWritten), reads: [...new Set(reads)] };
}

const TOKEN = /[$A-Za-z_][\w.$]*$/;

function matchesFor(suggestions: Suggestion[], token: string) {
  if (!token) return [];

  const lower = token.toLowerCase();

  return suggestions
    .filter((suggestion) => {
      const insert = suggestion.insert.toLowerCase();

      if (insert === lower) return false;

      if (insert.startsWith(lower)) return true;

      return !lower.includes(".") && insert.split(".").some((part) => part.startsWith(lower));
    })
    .slice(0, 8);
}

export function ExpressionInput({
  id,
  value,
  onChange,
  schema,
  repeat,
  hint,
  placeholder,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  schema: RiskSchema;
  repeat?: string;
  hint: string;
  placeholder?: string;
}) {
  const ready = useExpressionsReady();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [caret, setCaret] = useState(0);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const suggestions = useMemo(() => expressionSuggestions(schema, repeat), [schema, repeat]);

  const analysis = useMemo<Analysis>(
    () => (ready ? analyze(schema, value, repeat) : { status: "pending" }),
    [ready, schema, value, repeat],
  );

  const token = TOKEN.exec(value.slice(0, caret))?.[0] ?? "";
  const matches = open ? matchesFor(suggestions, token) : [];
  const showList = matches.length > 0;

  const trackCaret = (target: HTMLInputElement) =>
    setCaret(target.selectionStart ?? target.value.length);

  const accept = (suggestion: Suggestion) => {
    const start = caret - token.length;
    const next = value.slice(0, start) + suggestion.insert + value.slice(caret);
    const position = start + suggestion.insert.length;
    onChange(next);
    setCaret(position);
    setOpen(false);
    requestAnimationFrame(() => input.current?.setSelectionRange(position, position));
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showList) return;

    if (event.key === "ArrowDown") setActive((active + 1) % matches.length);
    else if (event.key === "ArrowUp") setActive((active - 1 + matches.length) % matches.length);
    else if (event.key === "Enter" || event.key === "Tab") accept(matches[active] ?? matches[0]!);
    else if (event.key === "Escape") setOpen(false);
    else return;

    event.preventDefault();
  };

  const invalid = analysis.status === "syntax";
  const unknown = analysis.status === "ok" ? analysis.unknown : [];

  return (
    <div className="grid gap-2">
      <div className="relative">
        <Input
          ref={input}
          id={id}
          value={value}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList ? `${listId}-${active}` : undefined}
          aria-invalid={invalid}
          className={cn(
            "font-mono text-[0.8125rem]",
            unknown.length > 0 &&
              "border-amber-300 focus-visible:border-amber-400 focus-visible:ring-amber-200/60",
          )}
          onChange={(event) => {
            onChange(event.target.value);
            trackCaret(event.target);
            setOpen(true);
            setActive(0);
          }}
          onSelect={(event) => trackCaret(event.currentTarget)}
          onKeyDown={onKeyDown}
          onBlur={() => setOpen(false)}
        />
        {showList && (
          <ul
            id={listId}
            role="listbox"
            className="absolute inset-x-0 top-full z-30 m-0 mt-1 grid list-none gap-px rounded-lg border bg-popover p-1 shadow-md"
          >
            {matches.map((match, i) => {
              const Icon = KIND_META[match.kind as keyof typeof KIND_META]?.icon;

              return (
                <li
                  key={match.insert}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => accept(match)}
                  className={cn(
                    "flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-sm",
                    i === active && "bg-muted",
                  )}
                >
                  {Icon && <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
                  <Code className="truncate">{match.insert}</Code>
                  <span className="ml-auto truncate pl-3 text-xs text-muted-foreground">
                    {match.label}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <ExpressionStatus analysis={analysis} hint={hint} />
    </div>
  );
}

function ExpressionStatus({ analysis, hint }: { analysis: Analysis; hint: string }) {
  if (analysis.status === "syntax") {
    return <p className="m-0 text-sm text-destructive">{analysis.message}</p>;
  }

  if (analysis.status === "ok" && analysis.unknown.length > 0) {
    const [first, ...rest] = analysis.unknown;

    return (
      <p className="m-0 flex items-center gap-2 text-sm text-amber-900">
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-amber-500" />
        <span>
          <Code className="text-amber-900">{first}</Code> isn't in the risk schema
          {rest.length > 0 &&
            `, nor ${rest.length === 1 ? "1 other path" : `${rest.length} other paths`}`}
          .
        </span>
      </p>
    );
  }

  const reads = analysis.status === "ok" && analysis.reads.length > 0 ? analysis.reads : undefined;

  return (
    <p className="m-0 text-xs leading-5 text-muted-foreground">
      {hint}
      {reads && ` Reads ${reads.join(", ")}.`}
    </p>
  );
}

export function ExpressionView({ value }: { value?: string }) {
  if (!value) return undefined;

  return (
    <code className="block rounded-md bg-muted/60 px-2.5 py-1.5 font-mono text-[0.8125rem] break-words">
      {value}
    </code>
  );
}
