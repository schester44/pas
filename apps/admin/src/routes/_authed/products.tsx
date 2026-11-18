import { Button } from "@pas/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@pas/ui/components/dialog";
import { EmptyState } from "@pas/ui/components/empty-state";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { Notice } from "@pas/ui/components/notice";
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import { Spinner } from "@pas/ui/components/spinner";
import { StatusChip, type StatusTone } from "@pas/ui/components/status-chip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pas/ui/components/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Layers, Plus } from "lucide-react";
import { useState } from "react";
import { formatDate, slugify } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/products")({
  component: ProductsPage,
});

const STATUS: Record<string, { label: string; tone: StatusTone }> = {
  draft: { label: "Draft", tone: "neutral" },
  active: { label: "Active", tone: "success" },
  retired: { label: "Retired", tone: "neutral" },
};

function ProductsPage() {
  const trpc = useTRPC();
  const products = useQuery(trpc.catalog.products.list.queryOptions());
  const [open, setOpen] = useState(false);

  const newProduct = (
    <Button size="sm" onClick={() => setOpen(true)}>
      <Plus /> New product
    </Button>
  );

  return (
    <>
      <PageHeader title="Products" actions={newProduct} />
      <PageBody className="max-w-6xl">
        <Panel flush>
          {products.data && products.data.length === 0 ? (
            <EmptyState
              icon={<Layers />}
              title="No products yet"
              description="A product holds everything about one offering: its data, forms, rating, rules and documents."
              action={
                <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
                  Create a product
                </Button>
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Line of business</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.isPending &&
                  Array.from({ length: 3 }, (_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={4}>
                        <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
                      </TableCell>
                    </TableRow>
                  ))}
                {products.data?.map((product) => {
                  const status = STATUS[product.status] ?? {
                    label: product.status,
                    tone: "neutral" as const,
                  };
                  return (
                    <TableRow key={product.id} className="hover:bg-muted/40">
                      <TableCell>
                        <div className="grid gap-0.5">
                          <span className="font-medium">{product.name}</span>
                          <span className="font-mono text-xs text-muted-foreground">
                            {product.key}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground capitalize">
                        {product.lineOfBusiness}
                      </TableCell>
                      <TableCell>
                        <StatusChip tone={status.tone}>{status.label}</StatusChip>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground tabular-nums">
                        {formatDate(product.createdAt)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Panel>
      </PageBody>
      <CreateProductDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function CreateProductDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyEdited, setKeyEdited] = useState(false);
  const create = useMutation(
    trpc.catalog.products.create.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: trpc.catalog.products.list.queryKey() });
        onOpenChange(false);
      },
    }),
  );

  function reset() {
    setName("");
    setKey("");
    setKeyEdited(false);
    create.reset();
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    create.mutate({ name, key, lineOfBusiness: String(form.get("lineOfBusiness")) });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogTrigger asChild>
        <span hidden />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New product</DialogTitle>
          <DialogDescription>
            You can add data, rating and rules once it's created.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              placeholder="Homeowners coastal"
              autoFocus
              required
              onChange={(event) => {
                setName(event.target.value);
                if (!keyEdited) setKey(slugify(event.target.value));
              }}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="key">Key</Label>
            <Input
              id="key"
              value={key}
              className="font-mono"
              required
              onChange={(event) => {
                setKeyEdited(true);
                setKey(event.target.value);
              }}
            />
            <p className="m-0 text-xs text-muted-foreground">
              Used in the API and exports. Can't be changed later.
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="lineOfBusiness">Line of business</Label>
            <Input id="lineOfBusiness" name="lineOfBusiness" placeholder="Homeowners" required />
          </div>
          {create.error && <Notice tone="error">{create.error.message}</Notice>}
          <DialogFooter className="pt-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Spinner />}
              Create product
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
