import { Button } from "@pas/ui/components/button";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pas/ui/components/table";
import { jurisdictionName, subdivisionsOf } from "@pas/ui/lib/jurisdictions";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Percent, Plus } from "lucide-react";
import { useState } from "react";
import { Field } from "@/components/distribution/agency-dialog";
import { tierLabel } from "@/components/distribution/format";
import { formatPlainDate } from "@/lib/format";
import { useAccess } from "@/lib/permissions";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/distribution/commissions")({
  component: CommissionsPage,
});

const ANY = "any";

const emptyRate = () => ({
  productId: ANY,
  subdivision: ANY,
  business: ANY,
  tier: "",
  rate: "",
  effectiveDate: new Date().toISOString().slice(0, 10),
});

function CommissionsPage() {
  const trpc = useTRPC();
  const access = useAccess();
  const queryClient = useQueryClient();
  const schedules = useQuery(trpc.distribution.rules.schedules.queryOptions());
  const products = useQuery(trpc.catalog.products.list.queryOptions());
  const [adding, setAdding] = useState(false);

  const productName = (id: string | null) =>
    id ? (products.data?.find((p) => p.id === id)?.name ?? "—") : "Any product";

  const remove = useMutation(
    trpc.distribution.rules.removeSchedule.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: trpc.distribution.rules.pathKey() }),
    }),
  );

  return (
    <>
      <PageHeader
        title="Commissions"
        actions={
          access.agencies.write && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus /> New rate
            </Button>
          )
        }
      />
      <PageBody className="max-w-6xl">
        <Panel
          flush
          title="Commission schedule"
          description="Each premium transaction earns the most specific rate in force on its effective date."
        >
          {schedules.data?.length === 0 ? (
            <EmptyState
              icon={<Percent />}
              title="No rates yet"
              description="Without a rate, commission records at zero."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Business</TableHead>
                  <TableHead>Agency tier</TableHead>
                  <TableHead>Effective</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  {access.agencies.write && <TableHead className="w-0" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {schedules.data?.map((s) => (
                  <TableRow key={s.id} className="h-13">
                    <TableCell className="font-medium">{productName(s.productId)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {s.subdivision
                        ? jurisdictionName({ country: s.country, subdivision: s.subdivision })
                        : `Any (${s.country})`}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {s.business === "new" ? "New" : s.business === "renewal" ? "Renewal" : "Any"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {s.tier ? tierLabel(s.tier) : "Any"}
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {formatPlainDate(s.effectiveDate)}
                      {s.expirationDate && ` – ${formatPlainDate(s.expirationDate)}`}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {Number(s.rate)}%
                    </TableCell>
                    {access.agencies.write && (
                      <TableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate({ id: s.id })}
                        >
                          Remove
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Panel>
      </PageBody>
      <ScheduleDialog open={adding} onOpenChange={setAdding} products={products.data ?? []} />
    </>
  );
}

function ScheduleDialog({
  open,
  onOpenChange,
  products,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: { id: string; name: string }[];
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(emptyRate);

  const set = (patch: Partial<ReturnType<typeof emptyRate>>) =>
    setDraft((d) => ({ ...d, ...patch }));

  const save = useMutation(
    trpc.distribution.rules.saveSchedule.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: trpc.distribution.rules.pathKey() });
        onOpenChange(false);
      },
    }),
  );

  const ready = /^\d{1,3}(\.\d{1,4})?$/.test(draft.rate) && draft.effectiveDate;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(emptyRate());

        save.reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New commission rate</DialogTitle>
          <DialogDescription>Leave a dimension on any to apply the rate broadly.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();

            if (!ready) return;

            save.mutate({
              productId: draft.productId === ANY ? null : draft.productId,
              country: "US",
              subdivision: draft.subdivision === ANY ? null : draft.subdivision,
              business: draft.business === ANY ? null : (draft.business as "new" | "renewal"),
              tier: draft.tier || null,
              rate: draft.rate,
              effectiveDate: draft.effectiveDate,
              expirationDate: null,
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Product" id="rate-product">
              <Select value={draft.productId} onValueChange={(productId) => set({ productId })}>
                <SelectTrigger id="rate-product">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any product</SelectItem>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="State" id="rate-state">
              <Select
                value={draft.subdivision}
                onValueChange={(subdivision) => set({ subdivision })}
              >
                <SelectTrigger id="rate-state">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any state</SelectItem>
                  {subdivisionsOf("US").map(([code, name]) => (
                    <SelectItem key={code} value={code}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Business" id="rate-business">
              <Select value={draft.business} onValueChange={(business) => set({ business })}>
                <SelectTrigger id="rate-business">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>New and renewal</SelectItem>
                  <SelectItem value="new">New</SelectItem>
                  <SelectItem value="renewal">Renewal</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Agency tier" id="rate-tier" optional>
              <Input
                id="rate-tier"
                value={draft.tier}
                placeholder="Any"
                onChange={(e) => set({ tier: e.target.value })}
              />
            </Field>
            <Field label="Rate (%)" id="rate-rate">
              <Input
                id="rate-rate"
                inputMode="decimal"
                value={draft.rate}
                onChange={(e) => set({ rate: e.target.value.replace(/[^\d.]/g, "") })}
              />
            </Field>
            <Field label="Effective" id="rate-effective">
              <Input
                id="rate-effective"
                type="date"
                value={draft.effectiveDate}
                onChange={(e) => set({ effectiveDate: e.target.value })}
              />
            </Field>
          </div>
          {save.error && <Notice tone="error">{save.error.message}</Notice>}
          <DialogFooter className="pt-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!ready || save.isPending}>
              {save.isPending && <Spinner />}
              Add rate
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
