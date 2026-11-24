import { Button } from "@pas/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@pas/ui/components/dialog";
import { EmptyState } from "@pas/ui/components/empty-state";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { Notice } from "@pas/ui/components/notice";
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import { Spinner } from "@pas/ui/components/spinner";
import { StatusChip } from "@pas/ui/components/status-chip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pas/ui/components/table";
import { Textarea } from "@pas/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { SkeletonRows } from "@/components/catalog/skeleton-rows";
import { pointLabel } from "@/components/extensions/labels";
import { formatDate, slugify } from "@/lib/format";
import { useAccess } from "@/lib/permissions";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/extensions/")({
  component: ExtensionsPage,
});

function ExtensionsPage() {
  const trpc = useTRPC();
  const access = useAccess();
  const navigate = useNavigate();
  const extensions = useQuery(trpc.extensions.list.queryOptions());
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        title="Extensions"
        actions={
          <>
            <Button size="sm" variant="outline" asChild>
              <Link to="/extensions/runs" search={{ filter: "failed" }}>
                Runs
              </Link>
            </Button>
            {access.extensions.write && (
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus /> New extension
              </Button>
            )}
          </>
        }
      />
      <PageBody className="max-w-6xl">
        {extensions.error && (
          <Notice tone="error" title="Couldn't load extensions">
            {extensions.error.message}
          </Notice>
        )}
        <Panel flush>
          {extensions.data?.length === 0 ? (
            <EmptyState
              title="No extensions yet"
              description="Write TypeScript for what configuration can't express, then bind it to a product."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Extension</TableHead>
                  <TableHead>Points</TableHead>
                  <TableHead>Published</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!extensions.data ? (
                  <SkeletonRows columns={4} />
                ) : (
                  extensions.data.map((extension) => (
                    <TableRow
                      key={extension.id}
                      className="h-13 cursor-pointer hover:bg-muted/40"
                      onClick={() =>
                        navigate({
                          to: "/extensions/$extensionId",
                          params: { extensionId: extension.id },
                        })
                      }
                    >
                      <TableCell>
                        <span className="grid gap-0.5">
                          <span className="flex items-center gap-2 font-medium">
                            {extension.name}
                            {extension.status === "archived" && (
                              <StatusChip tone="neutral">Archived</StatusChip>
                            )}
                          </span>
                          <span className="font-mono text-xs text-muted-foreground">
                            {extension.key}
                          </span>
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {extension.points.map(pointLabel).join(", ") || "–"}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {extension.latestVersion > 0 ? (
                          `Version ${extension.latestVersion}`
                        ) : (
                          <span className="text-muted-foreground">Not published</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground tabular-nums">
                        {formatDate(extension.updatedAt)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </Panel>
      </PageBody>
      <CreateExtensionDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

function CreateExtensionDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [keyEdited, setKeyEdited] = useState(false);
  const [description, setDescription] = useState("");

  const create = useMutation(
    trpc.extensions.create.mutationOptions({
      onSuccess: async (extension) => {
        await queryClient.invalidateQueries({ queryKey: trpc.extensions.list.queryKey() });
        onOpenChange(false);
        void navigate({ to: "/extensions/$extensionId", params: { extensionId: extension.id } });
      },
    }),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New extension</DialogTitle>
          <DialogDescription>
            It starts as a draft with a validate example to edit.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({ name, key, description: description || null });
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="extension-name">Name</Label>
            <Input
              id="extension-name"
              value={name}
              autoFocus
              onChange={(e) => {
                setName(e.target.value);

                if (!keyEdited) setKey(slugify(e.target.value).slice(0, 48));
              }}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="extension-key">Key</Label>
            <Input
              id="extension-key"
              value={key}
              className="font-mono text-xs"
              onChange={(e) => {
                setKeyEdited(true);
                setKey(e.target.value);
              }}
            />
          </div>
          <div className="grid gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <Label htmlFor="extension-description">Description</Label>
              <span className="text-xs text-muted-foreground">Optional</span>
            </div>
            <Textarea
              id="extension-description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          {create.error && (
            <Notice tone="error" title="Couldn't create the extension">
              {create.error.message}
            </Notice>
          )}
          <div className="flex justify-end">
            <Button type="submit" disabled={create.isPending || !name.trim() || !key.trim()}>
              {create.isPending && <Spinner />}
              Create extension
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
