import type { AdminOutputs } from "@pas/api-client";
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
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Layers, Plus } from "lucide-react";
import { useState } from "react";
import { formatDate, slugify } from "@/lib/format";
import { useAccess } from "@/lib/permissions";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/products/")({
  validateSearch: (search: Record<string, unknown>): { new?: true } =>
    search.new === true || search.new === "true" ? { new: true } : {},
  component: ProductsPage,
});

const STATUS: Record<string, { label: string; tone: StatusTone }> = {
  draft: { label: "Draft", tone: "neutral" },
  active: { label: "Active", tone: "success" },
  retired: { label: "Retired", tone: "neutral" },
};

function ProductsPage() {
  const trpc = useTRPC();
  const access = useAccess();
  const products = useQuery(trpc.catalog.products.list.queryOptions());
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const open = !!search.new && access.products.write;
  const setOpen = (next: boolean) => navigate({ search: next ? { new: true } : {}, replace: true });

  const newProduct = access.products.write ? (
    <Button size="sm" onClick={() => setOpen(true)}>
      <Plus /> New product
    </Button>
  ) : undefined;

  return (
    <>
      <PageHeader title="Products" actions={newProduct} />
      <PageBody className="max-w-6xl">
        <Panel flush>
          {products.error ? (
            <EmptyState
              icon={<Layers />}
              title={
                products.error.data?.code === "FORBIDDEN"
                  ? "You don't have access to products"
                  : "Couldn't load products"
              }
              description={
                products.error.data?.code === "FORBIDDEN"
                  ? "Ask an admin for a role that can view products."
                  : "Refresh the page to try again."
              }
            />
          ) : products.data && products.data.length === 0 ? (
            <EmptyState
              icon={<Layers />}
              title="No products yet"
              description="A product holds everything about one offering: its data, questions, rating, rules and documents."
              action={
                access.products.write && (
                  <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
                    Create a product
                  </Button>
                )
              }
            />
          ) : (
            <>
              <div className="hidden lg:block">
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
                        <TableRow
                          key={product.id}
                          className="cursor-pointer hover:bg-muted/40"
                          onClick={() =>
                            navigate({
                              to: "/products/$productId",
                              params: { productId: product.id },
                            })
                          }
                        >
                          <TableCell>
                            <div className="grid gap-0.5">
                              <Link
                                to="/products/$productId"
                                params={{ productId: product.id }}
                                className="font-medium outline-none hover:underline focus-visible:underline"
                                onClick={(event) => event.stopPropagation()}
                              >
                                {product.name}
                              </Link>
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
              </div>
              <ProductList products={products.data} />
            </>
          )}
        </Panel>
      </PageBody>
      <CreateProductDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

type Product = AdminOutputs["catalog"]["products"]["list"][number];

function ProductList({ products }: { products: Product[] | undefined }) {
  if (!products) {
    return (
      <div className="grid divide-y lg:hidden">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="grid gap-2 px-(--card-p) py-4">
            <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <ul className="m-0 grid list-none divide-y p-0 lg:hidden">
      {products.map((product) => {
        const status = STATUS[product.status] ?? {
          label: product.status,
          tone: "neutral" as const,
        };

        return (
          <li key={product.id}>
            <Link
              to="/products/$productId"
              params={{ productId: product.id }}
              className="flex items-start gap-3 px-(--card-p) py-4 outline-none hover:bg-muted/40 focus-visible:bg-muted/40"
            >
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate text-sm font-medium">{product.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  <span className="capitalize">{product.lineOfBusiness}</span> · Created{" "}
                  <span className="tabular-nums">{formatDate(product.createdAt)}</span>
                </span>
              </span>
              <StatusChip tone={status.tone}>{status.label}</StatusChip>
            </Link>
          </li>
        );
      })}
    </ul>
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
  const navigate = useNavigate();

  const create = useMutation(
    trpc.catalog.products.create.mutationOptions({
      onSuccess: async (product) => {
        await queryClient.invalidateQueries({ queryKey: trpc.catalog.products.list.queryKey() });
        await navigate({ to: "/products/$productId", params: { productId: product.id } });
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
