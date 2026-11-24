import type { AdminOutputs } from "@pas/api-client";
import { Button } from "@pas/ui/components/button";
import { Checkbox } from "@pas/ui/components/checkbox";
import {
  Dialog,
  DialogClose,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pas/ui/components/select";
import { Spinner } from "@pas/ui/components/spinner";
import { StatusChip } from "@pas/ui/components/status-chip";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Plus, Store, X } from "lucide-react";
import { useState } from "react";
import { slugify } from "@/lib/format";
import { useAccess } from "@/lib/permissions";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/offerings")({
  component: OfferingsPage,
});

type Offering = AdminOutputs["catalog"]["offerings"]["list"][number];
type Selection = Offering["selection"];

const SELECTION: Record<Selection, { label: string; description: string }> = {
  all_eligible: {
    label: "Agent compares",
    description: "When several products can write the risk, the agent compares them and chooses.",
  },
  cheapest: {
    label: "Lowest premium",
    description: "The quoted product with the lowest total.",
  },
  first_eligible: {
    label: "First eligible",
    description: "The first product in this order that quotes.",
  },
};

function OfferingsPage() {
  const trpc = useTRPC();
  const access = useAccess();
  const offerings = useQuery(trpc.catalog.offerings.list.queryOptions());
  const [editing, setEditing] = useState<Offering | "new" | null>(null);

  const newOffering = access.products.write ? (
    <Button size="sm" onClick={() => setEditing("new")}>
      <Plus /> New offering
    </Button>
  ) : undefined;

  return (
    <>
      <PageHeader title="Offerings" actions={newOffering} />
      <PageBody className="max-w-4xl">
        <Panel
          flush
          title="What agents quote"
          description="Agents pick an offering. PAS quotes its products and picks or compares them by eligibility and price."
        >
          {offerings.error ? (
            <EmptyState
              icon={<Store />}
              title="Couldn't load offerings"
              description="Refresh the page to try again."
            />
          ) : offerings.data?.length === 0 ? (
            <EmptyState
              icon={<Store />}
              title="No offerings yet"
              description="Agents can't start quotes until a product is in an offering."
              action={
                access.products.write && (
                  <Button variant="outline" size="sm" onClick={() => setEditing("new")}>
                    Create an offering
                  </Button>
                )
              }
            />
          ) : (
            <ul className="m-0 grid list-none divide-y p-0">
              {offerings.isPending && (
                <li className="px-(--card-p) py-4">
                  <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
                </li>
              )}
              {offerings.data?.map((offering) => (
                <li key={offering.id}>
                  <button
                    type="button"
                    disabled={!access.products.write}
                    onClick={() => setEditing(offering)}
                    className="flex w-full items-start gap-3 px-(--card-p) py-4 text-left outline-none hover:bg-muted/40 focus-visible:bg-muted/40 disabled:pointer-events-none"
                  >
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="text-sm leading-5 font-medium">{offering.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {SELECTION[offering.selection].label} ·{" "}
                        {offering.products.map((p) => p.name).join(", ")}
                      </span>
                    </span>
                    <StatusChip tone={offering.status === "active" ? "success" : "neutral"}>
                      {offering.status === "active" ? "Active" : "Retired"}
                    </StatusChip>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </PageBody>
      {editing && (
        <OfferingDialog
          key={editing === "new" ? "new" : editing.id}
          offering={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function OfferingDialog({ offering, onClose }: { offering: Offering | null; onClose: () => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const products = useQuery(trpc.catalog.products.list.queryOptions());
  const [name, setName] = useState(offering?.name ?? "");
  const [key, setKey] = useState("");
  const [keyEdited, setKeyEdited] = useState(false);
  const [selection, setSelection] = useState<Selection>(offering?.selection ?? "all_eligible");
  const [members, setMembers] = useState<string[]>(offering?.products.map((p) => p.id) ?? []);
  const [active, setActive] = useState(offering?.status !== "retired");

  const onSuccess = async () => {
    await queryClient.invalidateQueries({ queryKey: trpc.catalog.offerings.list.queryKey() });
    onClose();
  };

  const create = useMutation(trpc.catalog.offerings.create.mutationOptions({ onSuccess }));
  const update = useMutation(trpc.catalog.offerings.update.mutationOptions({ onSuccess }));
  const save = offering ? update : create;

  const nameOf = (id: string) =>
    products.data?.find((p) => p.id === id)?.name ??
    offering?.products.find((p) => p.id === id)?.name ??
    "Product";

  const addable = (products.data ?? []).filter(
    (p) => p.status !== "retired" && !members.includes(p.id),
  );

  const move = (index: number, by: -1 | 1) =>
    setMembers((current) => {
      const next = [...current];
      [next[index], next[index + by]] = [next[index + by]!, next[index]!];

      return next;
    });

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();

    const input = { name, selection, productIds: members };

    if (offering) update.mutate({ ...input, id: offering.id, active });
    else create.mutate({ ...input, key });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{offering ? offering.name : "New offering"}</DialogTitle>
          <DialogDescription>
            Changes apply to quotes started from now on. Started quotes keep their products.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="offering-name">Name</Label>
            <Input
              id="offering-name"
              value={name}
              placeholder="Landlord"
              autoFocus
              required
              onChange={(event) => {
                setName(event.target.value);

                if (!keyEdited) setKey(slugify(event.target.value));
              }}
            />
          </div>
          {!offering && (
            <div className="grid gap-2">
              <Label htmlFor="offering-key">Key</Label>
              <Input
                id="offering-key"
                value={key}
                className="font-mono"
                required
                onChange={(event) => {
                  setKeyEdited(true);
                  setKey(event.target.value);
                }}
              />
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="offering-selection">When several products quote</Label>
            <Select value={selection} onValueChange={(next) => setSelection(next as Selection)}>
              <SelectTrigger id="offering-selection">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SELECTION) as Selection[]).map((value) => (
                  <SelectItem key={value} value={value}>
                    {SELECTION[value].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="m-0 text-xs text-muted-foreground">{SELECTION[selection].description}</p>
          </div>
          <div className="grid gap-2">
            <Label>Products, in order of preference</Label>
            <p className="m-0 text-xs text-muted-foreground">
              The first product available in the risk's state supplies the questions, so every
              product here needs the same data.
            </p>
            {members.length > 0 && (
              <ol className="m-0 grid list-none divide-y rounded-lg border p-0">
                {members.map((id, index) => (
                  <li key={id} className="flex items-center gap-2 py-1.5 pr-1.5 pl-3">
                    <span className="w-5 text-xs text-muted-foreground tabular-nums">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">{nameOf(id)}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label="Move up"
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label="Move down"
                      disabled={index === members.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={`Remove ${nameOf(id)}`}
                      onClick={() => setMembers((current) => current.filter((m) => m !== id))}
                    >
                      <X />
                    </Button>
                  </li>
                ))}
              </ol>
            )}
            {addable.length > 0 && (
              <Select value="" onValueChange={(id) => setMembers((current) => [...current, id])}>
                <SelectTrigger aria-label="Add a product">
                  <SelectValue placeholder="Add a product" />
                </SelectTrigger>
                <SelectContent className="max-h-80">
                  {addable.map((product) => (
                    <SelectItem key={product.id} value={product.id}>
                      {product.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          {offering && (
            <Label className="flex items-center gap-2 font-normal">
              <Checkbox checked={active} onCheckedChange={(next) => setActive(next === true)} />
              Agents can start quotes for this offering
            </Label>
          )}
          {save.error && <Notice tone="error">{save.error.message}</Notice>}
          <DialogFooter className="pt-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={save.isPending || members.length === 0}>
              {save.isPending && <Spinner />}
              {offering ? "Save" : "Create offering"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
