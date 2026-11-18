import type { AdminOutputs } from "@pas/api-client";
import { Button } from "@pas/ui/components/button";
import { Checkbox } from "@pas/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@pas/ui/components/dialog";
import { EmptyState } from "@pas/ui/components/empty-state";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { Notice } from "@pas/ui/components/notice";
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import { RadioGroup, RadioGroupItem } from "@pas/ui/components/radio-group";
import { Spinner } from "@pas/ui/components/spinner";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Search, Users } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { portalState } from "@/components/policies/clients";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/clients")({
  component: ClientsPage,
});

type Client = AdminOutputs["clients"]["list"][number];

function ClientsPage() {
  const trpc = useTRPC();
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query.trim());
  const [selected, setSelected] = useState<string[]>([]);
  const [merging, setMerging] = useState(false);

  const clients = useQuery({
    ...trpc.clients.list.queryOptions({ query: deferred || undefined }),
    placeholderData: keepPreviousData,
  });

  const toggle = (id: string, on: boolean) =>
    setSelected((current) =>
      on ? [...current.filter((s) => s !== id), id].slice(-2) : current.filter((s) => s !== id),
    );

  const pair = (clients.data ?? []).filter((c) => selected.includes(c.id));

  return (
    <>
      <PageHeader title="Clients" />
      <PageBody className="max-w-6xl">
        <div className="relative max-w-sm">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or email"
            aria-label="Search clients"
            className="pl-9"
          />
        </div>
        <Panel
          flush
          footer={
            selected.length > 0 && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground tabular-nums">
                  {selected.length} selected{selected.length === 1 && " · select one more to merge"}
                </span>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
                    Clear
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pair.length !== 2}
                    onClick={() => setMerging(true)}
                  >
                    Merge
                  </Button>
                </div>
              </div>
            )
          }
        >
          {clients.error ? (
            <EmptyState
              icon={<Users />}
              title="Couldn't load clients"
              description="Refresh the page to try again."
            />
          ) : clients.data?.length === 0 ? (
            <EmptyState
              icon={<Users />}
              title={deferred ? "No clients match" : "No clients yet"}
              description={
                deferred
                  ? "Try a full email address or another name."
                  : "Named insureds appear here once a policy is bound."
              }
            />
          ) : (
            <ul className="m-0 list-none divide-y p-0">
              <li className="hidden h-10 items-center gap-4 bg-muted/40 px-(--card-p) text-xs font-medium text-muted-foreground lg:flex">
                <span className="w-4" />
                <span className="flex-1">Client</span>
                <span className="w-64">Email</span>
                <span className="w-48">Policies</span>
                <span className="w-36">Portal</span>
              </li>
              {clients.isPending &&
                [0, 1, 2].map((i) => (
                  <li key={i} className="px-(--card-p) py-4">
                    <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
                  </li>
                ))}
              {clients.data?.map((client) => (
                <ClientRow
                  key={client.id}
                  client={client}
                  checked={selected.includes(client.id)}
                  onCheckedChange={(on) => toggle(client.id, on)}
                />
              ))}
            </ul>
          )}
        </Panel>
        {pair.length === 2 && merging && (
          <MergeDialog
            pair={pair as [Client, Client]}
            onDone={() => {
              setMerging(false);
              setSelected([]);
            }}
          />
        )}
      </PageBody>
    </>
  );
}

function ClientRow({
  client,
  checked,
  onCheckedChange,
}: {
  client: Client;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <li className="flex items-start gap-4 px-(--card-p) py-3.5 lg:min-h-13 lg:items-center lg:py-2">
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        aria-label={`Select ${client.displayName}`}
        className="mt-0.5 lg:mt-0"
      />
      <span className="grid min-w-0 flex-1 gap-0.5 lg:flex lg:items-center lg:gap-4">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{client.displayName}</span>
        <span className="truncate text-xs text-muted-foreground lg:w-64 lg:text-sm">
          {client.emails.map((e) => e.address).join(", ") || "No email"}
        </span>
        <span className="flex flex-wrap gap-x-2 text-xs tabular-nums lg:w-48 lg:text-sm">
          {client.policies.map((policy) => (
            <Link
              key={`${policy.id}-${policy.role}`}
              to="/policies/$policyId"
              params={{ policyId: policy.id }}
              className="font-medium hover:underline"
            >
              {policy.number}
            </Link>
          ))}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums lg:w-36 lg:text-sm">
          {portalState(client)}
        </span>
      </span>
    </li>
  );
}

function MergeDialog({ pair, onDone }: { pair: [Client, Client]; onDone: () => void }) {
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
          onDone();
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
                    {[
                      client.emails[0]?.address,
                      `${client.policies.length} ${client.policies.length === 1 ? "policy" : "policies"}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
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
          <Button variant="outline" onClick={onDone}>
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
