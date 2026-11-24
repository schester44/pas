import { Button } from "@pas/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@pas/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@pas/ui/components/dropdown-menu";
import { Label } from "@pas/ui/components/label";
import { Notice } from "@pas/ui/components/notice";
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { Spinner } from "@pas/ui/components/spinner";
import { StatusChip } from "@pas/ui/components/status-chip";
import { Textarea } from "@pas/ui/components/textarea";
import { cn } from "@pas/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { Check, Ellipsis } from "lucide-react";
import { useState } from "react";
import { Breadcrumb } from "@/components/catalog/breadcrumb";
import {
  ExtensionEditorProvider,
  type TestReport,
  useExtensionEditor,
} from "@/components/extensions/extension-editor";
import { TestReportList } from "@/components/extensions/test-report";
import { useAccess } from "@/lib/permissions";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/extensions/$extensionId")({
  component: ExtensionLayout,
});

const TABS = [
  { to: "/extensions/$extensionId", label: "Code", exact: true },
  { to: "/extensions/$extensionId/tests", label: "Tests" },
  { to: "/extensions/$extensionId/settings", label: "Settings" },
  { to: "/extensions/$extensionId/versions", label: "Versions" },
  { to: "/extensions/$extensionId/runs", label: "Runs" },
] as const;

function ExtensionLayout() {
  const { extensionId } = Route.useParams();
  const trpc = useTRPC();
  const access = useAccess();
  const extension = useQuery(trpc.extensions.get.queryOptions({ id: extensionId }));

  const parents = [
    <Link key="extensions" to="/extensions">
      Extensions
    </Link>,
  ];

  if (extension.error) {
    return (
      <>
        <PageHeader title={<Breadcrumb parents={parents} current="Extension" />} />
        <PageBody className="max-w-6xl">
          <Notice tone="error" title="Couldn't load this extension">
            {extension.error.message}
          </Notice>
        </PageBody>
      </>
    );
  }

  if (!extension.data) {
    return (
      <>
        <PageHeader title={<Breadcrumb parents={parents} />} />
        <div className="h-11 border-b" />
        <PageBody className="max-w-6xl">
          <div className="h-96 animate-pulse rounded-xl bg-muted/60" />
        </PageBody>
      </>
    );
  }

  return (
    <ExtensionEditorProvider
      key={extension.data.id}
      extension={extension.data}
      canEdit={access.extensions.write}
    >
      <PageHeader
        title={
          <Breadcrumb
            parents={parents}
            current={
              <>
                <span className="truncate">{extension.data.name}</span>
                {extension.data.status === "archived" ? (
                  <StatusChip tone="neutral">Archived</StatusChip>
                ) : extension.data.latestVersion > 0 ? (
                  <StatusChip tone="success">Version {extension.data.latestVersion}</StatusChip>
                ) : (
                  <StatusChip tone="accent">Draft</StatusChip>
                )}
              </>
            }
          />
        }
        actions={<ExtensionActions />}
      />
      <nav
        aria-label="Extension"
        className="-mb-px flex gap-5 overflow-x-auto border-b bg-background px-4 sm:px-6"
      >
        {TABS.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            params={{ extensionId }}
            activeOptions={{ exact: "exact" in tab }}
            className={cn(
              "flex h-11 shrink-0 items-center border-b-2 border-transparent text-sm font-medium whitespace-nowrap text-muted-foreground hover:text-foreground",
              "[&.active]:border-primary [&.active]:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      <Outlet />
    </ExtensionEditorProvider>
  );
}

function ExtensionActions() {
  const trpc = useTRPC();
  const access = useAccess();
  const queryClient = useQueryClient();
  const { extension, saveState, retry, readOnly } = useExtensionEditor();
  const [publishing, setPublishing] = useState(false);

  const archive = useMutation(
    trpc.extensions.archive.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({
          queryKey: trpc.extensions.get.queryKey({ id: extension.id }),
        }),
    }),
  );

  return (
    <>
      {!readOnly && saveState === "error" && (
        <span className="flex items-center gap-1.5 text-xs text-red-700">
          Couldn't save
          <button
            type="button"
            onClick={retry}
            className="font-medium underline-offset-2 hover:underline"
          >
            Retry
          </button>
        </span>
      )}
      {!readOnly && (saveState === "saving" || saveState === "saved") && (
        <span
          aria-live="polite"
          className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground"
        >
          {saveState === "saving" ? (
            "Saving…"
          ) : (
            <>
              <Check aria-hidden className="size-3.5" /> Saved
            </>
          )}
        </span>
      )}
      {access.extensions.publish && extension.status === "active" && (
        <Button size="sm" disabled={saveState === "error"} onClick={() => setPublishing(true)}>
          Publish
        </Button>
      )}
      {access.extensions.write && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" aria-label="More">
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() =>
                archive.mutate({ id: extension.id, archived: extension.status === "active" })
              }
            >
              {extension.status === "active" ? "Archive" : "Restore"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {publishing && <PublishExtensionDialog onClose={() => setPublishing(false)} />}
    </>
  );
}

function PublishExtensionDialog({ onClose }: { onClose: () => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { extension, flush } = useExtensionEditor();
  const [note, setNote] = useState("");

  const publish = useMutation(
    trpc.extensions.publish.mutationOptions({
      onSuccess: async () => {
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: trpc.extensions.get.queryKey({ id: extension.id }),
          }),
          queryClient.invalidateQueries({ queryKey: trpc.extensions.list.queryKey() }),
          queryClient.invalidateQueries({ queryKey: trpc.extensions.versionChoices.queryKey() }),
        ]);
      },
    }),
  );

  const details = publish.error?.data?.details as
    | { issues?: string[]; report?: TestReport }
    | null
    | undefined;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {publish.data
              ? `Published version ${publish.data.version.version}`
              : "Publish extension"}
          </DialogTitle>
          <DialogDescription>
            {publish.data
              ? "Bind it to product versions or automations; nothing changes where an older version is pinned."
              : `Compiles the draft, runs every test against its fixtures and freezes it as version ${extension.latestVersion + 1}.`}
          </DialogDescription>
        </DialogHeader>
        {publish.data ? (
          <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              await flush();
              publish.mutate({ id: extension.id, note: note || null });
            }}
          >
            <div className="grid gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <Label htmlFor="publish-note">What changed</Label>
                <span className="text-xs text-muted-foreground">Optional</span>
              </div>
              <Textarea
                id="publish-note"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            {publish.error && (
              <Notice tone="error" title="Couldn't publish">
                {publish.error.message}
              </Notice>
            )}
            {details?.issues && (
              <ul className="m-0 grid list-disc gap-1 pl-5 text-sm text-muted-foreground">
                {details.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            )}
            {details?.report && <TestReportList report={details.report} />}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={publish.isPending}>
                {publish.isPending && <Spinner />}
                Publish version {extension.latestVersion + 1}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
