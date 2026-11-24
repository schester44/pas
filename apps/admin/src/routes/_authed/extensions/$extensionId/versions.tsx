import { Button } from "@pas/ui/components/button";
import { Checkbox } from "@pas/ui/components/checkbox";
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
import { PageBody } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pas/ui/components/select";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@pas/ui/components/sheet";
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
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { type ExtensionDetail, useExtensionEditor } from "@/components/extensions/extension-editor";
import { pointLabel } from "@/components/extensions/labels";
import { formatDate, formatDateTime } from "@/lib/format";
import { useAccess } from "@/lib/permissions";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/extensions/$extensionId/versions")({
  component: VersionsTab,
});

type Subscription = ExtensionDetail["subscriptions"][number];

function VersionsTab() {
  const { extension } = useExtensionEditor();
  const [viewing, setViewing] = useState<string | null>(null);
  const automationVersions = extension.versions.filter((v) => v.points.includes("automation"));

  return (
    <PageBody className="max-w-6xl">
      <Panel
        flush
        title="Published versions"
        description="Immutable. Product versions and automations pin one by id."
      >
        {extension.versions.length === 0 ? (
          <EmptyState
            title="Not published yet"
            description="Publish the draft once its tests pass."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Version</TableHead>
                <TableHead>Points</TableHead>
                <TableHead>Tests</TableHead>
                <TableHead>Published</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {extension.versions.map((v) => (
                <TableRow
                  key={v.id}
                  className="h-13 cursor-pointer hover:bg-muted/40"
                  onClick={() => setViewing(v.id)}
                >
                  <TableCell>
                    <span className="grid gap-0.5">
                      <span className="font-medium tabular-nums">Version {v.version}</span>
                      {v.note && <span className="text-xs text-muted-foreground">{v.note}</span>}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {v.points.map(pointLabel).join(", ")}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {v.testReport.results.length} passed
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {formatDate(v.publishedAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
      {automationVersions.length > 0 && (
        <AutomationsPanel extension={extension} versions={automationVersions} />
      )}
      <VersionSheet id={viewing} onClose={() => setViewing(null)} />
    </PageBody>
  );
}

function VersionSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const trpc = useTRPC();

  const version = useQuery({
    ...trpc.extensions.version.queryOptions({ id: id ?? "" }),
    enabled: !!id,
  });

  return (
    <Sheet open={!!id} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{version.data ? `Version ${version.data.version}` : "Version"}</SheetTitle>
          {version.data && (
            <SheetDescription>
              Published {formatDateTime(version.data.publishedAt)} ·{" "}
              <span className="font-mono">{version.data.contentHash.slice(0, 12)}</span>
            </SheetDescription>
          )}
        </SheetHeader>
        <SheetBody className="grid gap-5">
          {version.data &&
            Object.entries(version.data.source).map(([name, text]) => (
              <section key={name} className="grid gap-2">
                <h3 className="m-0 font-mono text-xs font-medium">{name}</h3>
                <pre className="m-0 max-h-96 overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-5">
                  {text}
                </pre>
              </section>
            ))}
          {version.data && (
            <section className="grid gap-2">
              <h3 className="m-0 text-sm font-medium">Allowed hosts</h3>
              <p className="m-0 font-mono text-xs text-muted-foreground">
                {version.data.manifest.allowedHosts.join(", ") || "None"}
              </p>
            </section>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

function AutomationsPanel({
  extension,
  versions,
}: {
  extension: ExtensionDetail;
  versions: ExtensionDetail["versions"];
}) {
  const trpc = useTRPC();
  const access = useAccess();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Partial<Subscription> | null>(null);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: trpc.extensions.get.queryKey({ id: extension.id }) });

  const remove = useMutation(
    trpc.extensions.deleteSubscription.mutationOptions({ onSuccess: refresh }),
  );

  const version = (id: string) => versions.find((v) => v.id === id)?.version;

  return (
    <Panel
      flush
      title="Automations"
      description="Runs a version's automation export when these domain events happen."
      action={
        access.extensions.publish && (
          <Button size="sm" variant="outline" onClick={() => setEditing({ enabled: true })}>
            <Plus /> Add automation
          </Button>
        )
      }
    >
      {extension.subscriptions.length === 0 ? (
        <EmptyState title="No automations" description="Nothing runs until an event is chosen." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {extension.subscriptions.map((s) => (
              <TableRow
                key={s.id}
                className="h-13 cursor-pointer hover:bg-muted/40"
                onClick={() => setEditing(s)}
              >
                <TableCell>
                  <span className="grid gap-0.5">
                    <span className="font-mono text-xs">{s.eventTypes.join(", ")}</span>
                    {s.condition && (
                      <span className="font-mono text-xs text-muted-foreground">
                        if {s.condition}
                      </span>
                    )}
                  </span>
                </TableCell>
                <TableCell className="tabular-nums">
                  Version {version(s.extensionVersionId) ?? "?"}
                </TableCell>
                <TableCell>
                  <StatusChip tone={s.enabled ? "success" : "neutral"}>
                    {s.enabled ? "On" : "Off"}
                  </StatusChip>
                </TableCell>
                <TableCell>
                  {access.extensions.publish && (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Remove automation"
                      onClick={(e) => {
                        e.stopPropagation();
                        remove.mutate({ id: s.id });
                      }}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {editing && (
        <SubscriptionDialog
          extensionId={extension.id}
          subscription={editing}
          versions={versions}
          readOnly={!access.extensions.publish}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
    </Panel>
  );
}

function SubscriptionDialog({
  extensionId,
  subscription,
  versions,
  readOnly,
  onClose,
  onSaved,
}: {
  extensionId: string;
  subscription: Partial<Subscription>;
  versions: ExtensionDetail["versions"];
  readOnly: boolean;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const trpc = useTRPC();

  const [versionId, setVersionId] = useState(
    subscription.extensionVersionId ?? versions[0]?.id ?? "",
  );

  const [events, setEvents] = useState((subscription.eventTypes ?? []).join("\n"));
  const [condition, setCondition] = useState(subscription.condition ?? "");
  const [enabled, setEnabled] = useState(subscription.enabled ?? true);
  const known = useQuery(trpc.extensions.eventTypes.queryOptions());

  const save = useMutation(
    trpc.extensions.saveSubscription.mutationOptions({
      onSuccess: async () => {
        await onSaved();
        onClose();
      },
    }),
  );

  const eventTypes = events
    .split(/[\n,]/)
    .map((e) => e.trim())
    .filter(Boolean);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{subscription.id ? "Automation" : "Add automation"}</DialogTitle>
          <DialogDescription>
            Each run is idempotent on the event, so a redelivered event doesn't run it twice.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();

            save.mutate({
              ...(subscription.id && { id: subscription.id }),
              extensionId,
              extensionVersionId: versionId,
              eventTypes,
              condition: condition || null,
              enabled,
            });
          }}
        >
          <fieldset disabled={readOnly} className="m-0 grid gap-4 border-0 p-0">
            <div className="grid gap-2">
              <Label htmlFor="subscription-version">Version</Label>
              <Select value={versionId} onValueChange={setVersionId}>
                <SelectTrigger id="subscription-version">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {versions.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      Version {v.version}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="subscription-events">Events</Label>
                <Select
                  value=""
                  onValueChange={(type) =>
                    !eventTypes.includes(type) && setEvents([...eventTypes, type].join("\n"))
                  }
                >
                  <SelectTrigger size="sm" className="w-48" aria-label="Add an event">
                    <SelectValue placeholder="Add an event" />
                  </SelectTrigger>
                  <SelectContent>
                    {(known.data ?? [])
                      .filter((type) => !eventTypes.includes(type))
                      .map((type) => (
                        <SelectItem key={type} value={type}>
                          <span className="font-mono text-xs">{type}</span>
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <Textarea
                id="subscription-events"
                rows={3}
                className="font-mono text-xs"
                placeholder={"policy.term_bound\nbilling.payment_failed"}
                value={events}
                onChange={(e) => setEvents(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <Label htmlFor="subscription-condition">Only when</Label>
                <span className="text-xs text-muted-foreground">Optional</span>
              </div>
              <Input
                id="subscription-condition"
                className="font-mono text-xs"
                placeholder='event.payload.jurisdiction.subdivision == "US-FL"'
                value={condition}
                onChange={(e) => setCondition(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} />
              On
            </label>
          </fieldset>
          {save.error && (
            <Notice tone="error" title="Couldn't save the automation">
              {save.error.message}
            </Notice>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {readOnly ? "Close" : "Cancel"}
            </Button>
            {!readOnly && (
              <Button
                type="submit"
                disabled={save.isPending || !versionId || eventTypes.length === 0}
              >
                {save.isPending && <Spinner />}
                Save automation
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
