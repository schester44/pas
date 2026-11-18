import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Kbd,
} from "@pas/ui/components/command";
import {
  modKey,
  paletteFilter,
  RecentGroups,
  SearchEmpty,
  type SearchResult,
  SearchResultGroups,
  useDebouncedValue,
  usePaletteShortcuts,
  useRecentSearches,
} from "@pas/ui/components/global-search";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { House, Plus, Search } from "lucide-react";
import { useState } from "react";
import { useTRPC } from "@/lib/trpc";

export function SearchTrigger({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  usePaletteShortcuts(setOpen);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-8 w-full max-w-xs items-center gap-2.5 rounded-md border bg-background px-2.5 text-sm text-muted-foreground shadow-xs transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <Search aria-hidden className="size-4 shrink-0" />
        <span className="flex-1 truncate text-left">Search</span>
        <Kbd className="hidden sm:inline-flex">{modKey}K</Kbd>
      </button>
      <SearchPalette userId={userId} open={open} onOpenChange={setOpen} />
    </>
  );
}

function SearchPalette({
  userId,
  open,
  onOpenChange,
}: {
  userId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const query = useDebouncedValue(search.trim(), 120);
  const { recent, remember } = useRecentSearches(`pas.app.search.${userId}`);

  const results = useQuery({
    ...trpc.search.query.queryOptions({ q: query }),
    enabled: open && query.length > 0,
    placeholderData: keepPreviousData,
  });

  const searching = search.trim() !== query || results.isFetching;

  function changeOpen(next: boolean) {
    if (!next) setSearch("");

    onOpenChange(next);
  }

  function run(action: () => unknown) {
    changeOpen(false);
    void action();
  }

  function openResult(result: SearchResult) {
    remember(result, search);

    run(() =>
      result.type === "submission"
        ? navigate({ to: "/submissions/$submissionId", params: { submissionId: result.id } })
        : result.policyId
          ? navigate({ to: "/policies/$policyId", params: { policyId: result.policyId } })
          : navigate({ to: "/" }),
    );
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={changeOpen}
      commandProps={{ filter: paletteFilter }}
      title="Search"
      description="Search your policies, quotes and clients."
    >
      <CommandInput
        value={search}
        onValueChange={setSearch}
        placeholder="Search policies, quotes, clients or addresses"
      />
      <CommandList>
        <CommandEmpty>
          <SearchEmpty query={search.trim()} searching={searching} />
        </CommandEmpty>
        {search.trim() ? (
          <SearchResultGroups results={results.data ?? []} keyword={search} onSelect={openResult} />
        ) : (
          <RecentGroups recent={recent} onSelectResult={openResult} onSelectQuery={setSearch} />
        )}
        <CommandGroup heading="Go to">
          <CommandItem
            keywords={["home", "quotes"]}
            onSelect={() => run(() => navigate({ to: "/" }))}
          >
            <House /> Home
          </CommandItem>
          <CommandItem
            keywords={["new", "quote", "submission"]}
            onSelect={() => run(() => navigate({ to: "/submissions/new" }))}
          >
            <Plus /> Start a quote
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
