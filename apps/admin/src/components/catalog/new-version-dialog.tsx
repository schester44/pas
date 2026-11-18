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
} from "@pas/ui/components/dialog";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { Notice } from "@pas/ui/components/notice";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pas/ui/components/select";
import { Spinner } from "@pas/ui/components/spinner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTRPC } from "@/lib/trpc";
import { nextVersionLabel } from "./availability-summary";

type VersionSummary = AdminOutputs["catalog"]["versions"]["list"][number];

const EMPTY = "empty";

const STATUS_LABEL: Record<string, string> = {
  draft: "draft",
  in_review: "in review",
  published: "published",
  retired: "retired",
};

export function NewVersionDialog({
  productId,
  versions,
  copyFromId,
  open,
  onOpenChange,
}: {
  productId: string;
  versions: readonly VersionSummary[];
  copyFromId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open && (
          <NewVersionForm
            productId={productId}
            versions={versions}
            copyFromId={copyFromId}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function defaultSource(versions: readonly VersionSummary[]): string {
  return (versions.find((v) => v.status === "published") ?? versions[0])?.id ?? EMPTY;
}

function NewVersionForm({
  productId,
  versions,
  copyFromId,
  onDone,
}: {
  productId: string;
  versions: readonly VersionSummary[];
  copyFromId?: string;
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [label, setLabel] = useState(() => nextVersionLabel(versions.map((v) => v.version)));
  const [source, setSource] = useState(() => copyFromId ?? defaultSource(versions));
  const copying = copyFromId !== undefined;

  const onSuccess = async (created: { id: string }) => {
    await queryClient.invalidateQueries({
      queryKey: trpc.catalog.versions.list.queryKey({ productId }),
    });

    onDone();

    await navigate({
      to: "/products/$productId/versions/$versionId",
      params: { productId, versionId: created.id },
    });
  };

  const create = useMutation(trpc.catalog.versions.create.mutationOptions({ onSuccess }));
  const copy = useMutation(trpc.catalog.versions.copy.mutationOptions({ onSuccess }));
  const pending = create.isPending || copy.isPending;
  const error = create.error ?? copy.error;

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (source === EMPTY) create.mutate({ productId, version: label });
    else copy.mutate({ id: source, version: label });
  }

  const sourceLabel = versions.find((v) => v.id === copyFromId)?.version;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{copying ? `Copy ${sourceLabel}` : "New version"}</DialogTitle>
        <DialogDescription>
          {copying
            ? "The copy starts as a draft with everything from this version."
            : "Versions start as drafts. Copy an existing version to change it."}
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={onSubmit} className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="version-label">Version</Label>
          <Input
            id="version-label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            className="tabular-nums"
            autoFocus
            required
          />
        </div>
        {!copying && (
          <div className="grid gap-2">
            <Label htmlFor="version-source">Start from</Label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger id="version-source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {versions.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    Copy of {v.version} ({STATUS_LABEL[v.status] ?? v.status})
                  </SelectItem>
                ))}
                <SelectItem value={EMPTY}>Empty version</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        {error && <Notice tone="error">{error.message}</Notice>}
        <DialogFooter className="pt-2">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button type="submit" disabled={pending || !label.trim()}>
            {pending && <Spinner />}
            {copying ? "Create copy" : "Create version"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
