import { Button } from "@pas/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@pas/ui/components/dialog";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { Notice } from "@pas/ui/components/notice";
import { RadioGroup, RadioGroupItem } from "@pas/ui/components/radio-group";
import { Spinner } from "@pas/ui/components/spinner";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { useTRPC } from "@/lib/trpc";

export interface MergeCandidate {
  id: string;
  displayName: string;
  emails: { address: string }[];
  policies: unknown[];
}

const summary = (client: MergeCandidate) =>
  [
    client.emails[0]?.address,
    `${client.policies.length} ${client.policies.length === 1 ? "policy" : "policies"}`,
  ]
    .filter(Boolean)
    .join(" · ");

/** Picks the client to merge with: search by name or email, excluding the one already open. */
export function PickClientDialog({
  excludeId,
  onPick,
  onCancel,
}: {
  excludeId: string;
  onPick: (client: MergeCandidate) => void;
  onCancel: () => void;
}) {
  const trpc = useTRPC();
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query.trim());

  const clients = useQuery({
    ...trpc.clients.list.queryOptions({ query: deferred || undefined }),
    placeholderData: keepPreviousData,
  });

  const options = (clients.data ?? []).filter((c) => c.id !== excludeId).slice(0, 8);

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Merge with another client</DialogTitle>
          <DialogDescription>Find the duplicate record.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or email"
            aria-label="Search clients"
            className="pl-9"
          />
        </div>
        <ul className="m-0 grid max-h-72 list-none gap-1 overflow-y-auto p-0">
          {options.map((client) => (
            <li key={client.id}>
              <button
                type="button"
                onClick={() => onPick(client)}
                className="grid w-full gap-0.5 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
              >
                <span className="font-medium">{client.displayName}</span>
                <span className="truncate text-xs text-muted-foreground tabular-nums">
                  {summary(client)}
                </span>
              </button>
            </li>
          ))}
          {clients.data && options.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">
              No other clients match
            </li>
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

export function MergeDialog({
  pair,
  onDone,
}: {
  pair: [MergeCandidate, MergeCandidate];
  onDone: (survivorId?: string) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [survivorId, setSurvivorId] = useState(pair[0].id);
  const merge = useMutation(trpc.clients.merge.mutationOptions());
  const merged = pair.find((c) => c.id !== survivorId)!;

  const submit = () =>
    merge.mutate(
      { survivorId, mergedId: merged.id },
      {
        onSuccess: async () => {
          await queryClient.invalidateQueries({ queryKey: trpc.clients.pathKey() });
          onDone(survivorId);
        },
      },
    );

  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Merge clients</DialogTitle>
          <DialogDescription>
            Policies, emails and portal access move to the record you keep.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label>Keep</Label>
          <RadioGroup value={survivorId} onValueChange={setSurvivorId}>
            {pair.map((client) => (
              <label
                key={client.id}
                className="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors has-data-[state=checked]:border-primary/40 has-data-[state=checked]:bg-primary/5"
              >
                <RadioGroupItem value={client.id} className="mt-0.5" />
                <span className="grid min-w-0 gap-0.5">
                  <span className="font-medium">{client.displayName}</span>
                  <span className="truncate text-xs text-muted-foreground tabular-nums">
                    {summary(client)}
                  </span>
                </span>
              </label>
            ))}
          </RadioGroup>
        </div>
        {merge.error && (
          <Notice tone="error" title="Couldn't merge">
            {merge.error.message}
          </Notice>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onDone()}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={merge.isPending}>
            {merge.isPending && <Spinner />}
            Merge into {pair.find((c) => c.id === survivorId)!.displayName}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
