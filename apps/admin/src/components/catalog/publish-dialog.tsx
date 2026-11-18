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
import { Notice } from "@pas/ui/components/notice";
import { Spinner } from "@pas/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { jurisdictionName } from "@pas/ui/lib/jurisdictions";
import { useTRPC } from "@/lib/trpc";
import { IssueDot } from "./issue-dot";
import { type ProductVersion, useVersionEditor } from "./version-editor";

function listFormat(items: string[]): string {
  return new Intl.ListFormat(undefined, { style: "long", type: "conjunction" }).format(items);
}

function useInvalidateVersion() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return async (next: ProductVersion) => {
    queryClient.setQueryData(trpc.catalog.versions.get.queryKey({ id: next.id }), next);

    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: trpc.catalog.versions.list.queryKey({ productId: next.productId }),
      }),
      queryClient.invalidateQueries({
        queryKey: trpc.catalog.releases.list.queryKey({ productId: next.productId }),
      }),
      queryClient.invalidateQueries({
        queryKey: trpc.catalog.versions.check.queryKey({ id: next.id }),
      }),
      queryClient.invalidateQueries({ queryKey: trpc.catalog.products.get.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.catalog.products.list.queryKey() }),
    ]);
  };
}

export function PublishDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const trpc = useTRPC();
  const { version, contents } = useVersionEditor();

  const checks = useQuery({
    ...trpc.catalog.versions.check.queryOptions({ id: version.id }),
    enabled: open,
  });

  const invalidate = useInvalidateVersion();

  const publish = useMutation(
    trpc.catalog.versions.publish.mutationOptions({
      onSuccess: async ({ version: next }) => {
        await invalidate(next);
        onOpenChange(false);
      },
    }),
  );

  const errors = checks.data?.filter((issue) => issue.severity === "error") ?? [];
  const warnings = checks.data?.filter((issue) => issue.severity === "warning") ?? [];
  const places = listFormat(contents.availability.map((w) => jurisdictionName(w.jurisdiction)));
  const params = { productId: version.productId, versionId: version.id };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) publish.reset();

        onOpenChange(next);
      }}
    >
      <DialogContent>
        {!checks.data ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground">
            <Spinner />
          </div>
        ) : errors.length > 0 ? (
          <>
            <DialogHeader>
              <DialogTitle>
                Fix {errors.length === 1 ? "1 issue" : `${errors.length} issues`} to publish
              </DialogTitle>
              <DialogDescription>
                Move this version back to draft, fix what's listed, then submit it again.
              </DialogDescription>
            </DialogHeader>
            <IssueList messages={errors.slice(0, 4).map((issue) => issue.message)} tone="error" />
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Close</Button>
              </DialogClose>
              <Button asChild>
                <Link
                  to="/products/$productId/versions/$versionId/checks"
                  params={params}
                  onClick={() => onOpenChange(false)}
                >
                  Review checks
                </Link>
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Publish {version.version}</DialogTitle>
              <DialogDescription>
                Creates a release for {places}. Published versions can't be changed; copy one to
                make changes.
              </DialogDescription>
            </DialogHeader>
            {warnings.length > 0 && (
              <IssueList messages={warnings.map((issue) => issue.message)} tone="warning" />
            )}
            {publish.error && <Notice tone="error">{publish.error.message}</Notice>}
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button
                disabled={publish.isPending}
                onClick={() => publish.mutate({ id: version.id })}
              >
                {publish.isPending && <Spinner />}
                Publish version
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function IssueList({ messages, tone }: { messages: string[]; tone: "error" | "warning" }) {
  return (
    <ul className="m-0 grid list-none gap-2.5 rounded-lg border bg-muted/40 p-3 text-sm">
      {messages.map((message, i) => (
        <li key={i} className="flex gap-2.5">
          <IssueDot severity={tone} />
          <span>{message}</span>
        </li>
      ))}
    </ul>
  );
}

export function RetireDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const trpc = useTRPC();
  const { version } = useVersionEditor();
  const invalidate = useInvalidateVersion();

  const retire = useMutation(
    trpc.catalog.versions.retire.mutationOptions({
      onSuccess: async (next) => {
        await invalidate(next);
        onOpenChange(false);
      },
    }),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Retire {version.version}</DialogTitle>
          <DialogDescription>
            New quotes and renewals stop resolving to this version. Policies already written on it
            keep it.
          </DialogDescription>
        </DialogHeader>
        {retire.error && <Notice tone="error">{retire.error.message}</Notice>}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={retire.isPending}
            onClick={() => retire.mutate({ id: version.id })}
          >
            {retire.isPending && <Spinner />}
            Retire version
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
