import {
  History,
  Inbox,
  Layers,
  type LucideIcon,
  Receipt,
  ScrollText,
  UserRound,
  Users,
} from "lucide-react";
import type * as React from "react";
import { useCallback, useEffect, useState } from "react";
import { defaultFilter } from "cmdk";
import { CommandGroup, CommandItem } from "./command";
import { Spinner } from "./spinner";

export type SearchResultType =
  | "client"
  | "policy"
  | "submission"
  | "invoice"
  | "product"
  | "member";

export interface SearchResult {
  type: SearchResultType;
  id: string;
  title: string;
  details: string[];
  status: string | null;
  policyId: string | null;
}

const GROUPS: { type: SearchResultType; heading: string; icon: LucideIcon }[] = [
  { type: "policy", heading: "Policies", icon: ScrollText },
  { type: "submission", heading: "Submissions", icon: Inbox },
  { type: "client", heading: "Clients", icon: Users },
  { type: "invoice", heading: "Invoices", icon: Receipt },
  { type: "product", heading: "Products", icon: Layers },
  { type: "member", heading: "Members", icon: UserRound },
];

const ICONS = Object.fromEntries(GROUPS.map((g) => [g.type, g.icon])) as Record<
  SearchResultType,
  LucideIcon
>;

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export const modKey = isMac ? "⌘" : "Ctrl ";

/** cmdk's fuzzy score, minus the long-tail matches ("maple" → "Members") that read as noise. */
export const paletteFilter: typeof defaultFilter = (value, search, keywords) => {
  const score = defaultFilter(value, search, keywords);

  return score >= 0.05 ? score : 0;
};

const humanize = (status: string) => {
  const words = status.replace(/_/g, " ");

  return words.charAt(0).toUpperCase() + words.slice(1);
};

function isTyping(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;

  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

/** ⌘K toggles the palette; `/` opens it when no text field has focus. */
export function usePaletteShortcuts(setOpen: React.Dispatch<React.SetStateAction<boolean>>) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey) && !event.altKey) {
        event.preventDefault();
        setOpen((open) => !open);

        return;
      }

      const plain = !event.metaKey && !event.ctrlKey && !event.altKey;

      if (event.key === "/" && plain && !isTyping(event.target)) {
        event.preventDefault();
        setOpen(true);
      }
    }

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setOpen]);
}

export function useDebouncedValue<T>(value: T, ms = 120): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);

    return () => clearTimeout(timer);
  }, [value, ms]);

  return debounced;
}

interface Recent {
  results: SearchResult[];
  queries: string[];
}

const EMPTY: Recent = { results: [], queries: [] };

function readRecent(key: string): Recent {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "null") as Recent | null;

    return parsed && Array.isArray(parsed.results) && Array.isArray(parsed.queries)
      ? parsed
      : EMPTY;
  } catch {
    return EMPTY;
  }
}

/** Recently opened results and the queries that found them, per user, in this browser. */
export function useRecentSearches(key: string) {
  const [recent, setRecent] = useState<Recent>(() => readRecent(key));

  const remember = useCallback(
    (result: SearchResult, query: string) => {
      setRecent((current) => {
        const q = query.trim();

        const next: Recent = {
          results: [result, ...current.results.filter((r) => r.id !== result.id)].slice(0, 5),
          queries: q
            ? [q, ...current.queries.filter((existing) => existing !== q)].slice(0, 3)
            : current.queries,
        };

        localStorage.setItem(key, JSON.stringify(next));

        return next;
      });
    },
    [key],
  );

  return { recent, remember };
}

function ResultItem({
  result,
  keyword,
  onSelect,
}: {
  result: SearchResult;
  keyword: string;
  onSelect: () => void;
}) {
  const Icon = ICONS[result.type];
  const secondary = [...result.details, ...(result.status ? [humanize(result.status)] : [])];

  return (
    <CommandItem
      value={`${keyword} ${result.type}:${result.id}`}
      keywords={[keyword]}
      onSelect={onSelect}
      className="h-auto min-h-11 py-1.5"
    >
      <Icon />
      <span className="grid min-w-0 flex-1 leading-tight">
        <span className="truncate font-medium tabular-nums">{result.title}</span>
        {secondary.length > 0 && (
          <span className="truncate text-xs text-muted-foreground">{secondary.join(" · ")}</span>
        )}
      </span>
    </CommandItem>
  );
}

/** Server results grouped by type. cmdk only re-scores on value change, so the live input is part of it. */
export function SearchResultGroups({
  results,
  keyword,
  onSelect,
}: {
  results: SearchResult[];
  keyword: string;
  onSelect: (result: SearchResult) => void;
}) {
  return GROUPS.map(({ type, heading }) => {
    const hits = results.filter((r) => r.type === type);

    if (hits.length === 0) return null;

    return (
      <CommandGroup key={type} heading={heading}>
        {hits.map((result) => (
          <ResultItem
            key={result.id}
            result={result}
            keyword={keyword}
            onSelect={() => onSelect(result)}
          />
        ))}
      </CommandGroup>
    );
  });
}

export function RecentGroups({
  recent,
  onSelectResult,
  onSelectQuery,
}: {
  recent: Recent;
  onSelectResult: (result: SearchResult) => void;
  onSelectQuery: (query: string) => void;
}) {
  return (
    <>
      {recent.results.length > 0 && (
        <CommandGroup heading="Recently viewed">
          {recent.results.map((result) => (
            <ResultItem
              key={result.id}
              result={result}
              keyword=""
              onSelect={() => onSelectResult(result)}
            />
          ))}
        </CommandGroup>
      )}
      {recent.queries.length > 0 && (
        <CommandGroup heading="Recent searches">
          {recent.queries.map((query) => (
            <CommandItem
              key={query}
              value={`recent-query:${query}`}
              onSelect={() => onSelectQuery(query)}
            >
              <History /> {query}
            </CommandItem>
          ))}
        </CommandGroup>
      )}
    </>
  );
}

export function SearchEmpty({ query, searching }: { query: string; searching: boolean }) {
  if (searching) {
    return (
      <span className="inline-flex items-center gap-2">
        <Spinner /> Searching…
      </span>
    );
  }

  return (
    <>
      No results for <span className="font-medium text-foreground">“{query}”</span>
    </>
  );
}
