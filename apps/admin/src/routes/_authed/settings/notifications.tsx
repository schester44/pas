import type { AdminOutputs } from "@pas/api-client";
import { Button } from "@pas/ui/components/button";
import { Checkbox } from "@pas/ui/components/checkbox";
import { Dialog, DialogContent } from "@pas/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@pas/ui/components/dropdown-menu";
import { EmptyState } from "@pas/ui/components/empty-state";
import { Notice } from "@pas/ui/components/notice";
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import { Spinner } from "@pas/ui/components/spinner";
import { StatusChip } from "@pas/ui/components/status-chip";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Ellipsis, MessageSquare, Plus } from "lucide-react";
import { useState } from "react";
import {
  describePatterns,
  draftOf,
  emptyDraft,
  GROUP_LABELS,
  type SubscriptionDraft,
  SubscriptionForm,
  useEventCatalog,
} from "@/components/events/subscriptions";
import { useAccess } from "@/lib/permissions";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/settings/notifications")({
  component: NotificationsPage,
});

function NotificationsPage() {
  const access = useAccess();

  return (
    <>
      <PageHeader title="Notifications" />
      <PageBody className="max-w-4xl">
        <MyNotifications />
        {access.branding.update && <ChatDestinations />}
      </PageBody>
    </>
  );
}

type Preferences = AdminOutputs["notifications"]["preferences"];

function MyNotifications() {
  const trpc = useTRPC();
  const preferences = useQuery(trpc.notifications.preferences.queryOptions());

  return (
    <Panel
      title="In-app notifications"
      description="What shows up under the bell for you. Producers only hear about their own book."
      flush
    >
      {preferences.error ? (
        <div className="p-(--card-p)">
          <Notice tone="error" title="Couldn't load your preferences">
            {preferences.error.message}
          </Notice>
        </div>
      ) : !preferences.data ? (
        <div className="h-72 animate-pulse bg-muted/30" />
      ) : (
        <PreferencesForm key={preferences.dataUpdatedAt} preferences={preferences.data} />
      )}
    </Panel>
  );
}

function PreferencesForm({ preferences }: { preferences: Preferences }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [enabled, setEnabled] = useState(
    () => new Set(preferences.types.filter((t) => t.enabled).map((t) => t.type)),
  );

  const save = useMutation(
    trpc.notifications.setPreferences.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: trpc.notifications.preferences.queryKey() }),
    }),
  );

  const dirty = preferences.types.some((t) => t.enabled !== enabled.has(t.type));
  const groups = new Map<string, Preferences["types"]>();

  for (const t of preferences.types) {
    const group = t.type.slice(0, t.type.indexOf("."));
    groups.set(group, [...(groups.get(group) ?? []), t]);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ eventTypes: [...enabled] });
      }}
    >
      <div className="grid gap-5 p-(--card-p)">
        {[...groups.entries()].map(([group, types]) => (
          <fieldset key={group} className="m-0 grid gap-2 border-0 p-0">
            <legend className="mb-2 p-0 text-xs font-medium text-muted-foreground">
              {GROUP_LABELS[group] ?? group}
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {types.map((t) => (
                <label key={t.type} className="flex items-start gap-2.5 text-sm">
                  <Checkbox
                    className="mt-0.5"
                    checked={enabled.has(t.type)}
                    onCheckedChange={(on) =>
                      setEnabled((current) => {
                        const next = new Set(current);

                        if (on === true) next.add(t.type);
                        else next.delete(t.type);

                        return next;
                      })
                    }
                  />
                  <span className="grid gap-0.5">
                    <span className="font-medium">{t.title}</span>
                    <span className="text-xs text-muted-foreground">{t.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        {save.error && (
          <Notice tone="error" title="Couldn't save">
            {save.error.message}
          </Notice>
        )}
      </div>
      <footer className="flex items-center justify-between gap-3 border-t bg-muted/50 px-(--card-p) py-3">
        <span className="text-xs text-muted-foreground">
          {preferences.customized ? "Your choices" : "Defaults for your role"}
        </span>
        <Button type="submit" size="sm" disabled={!dirty || save.isPending}>
          {save.isPending && <Spinner />}
          Save preferences
        </Button>
      </footer>
    </form>
  );
}

function ChatDestinations() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const catalog = useEventCatalog();
  const list = useQuery(trpc.events.subscriptions.list.queryOptions({ kind: "chat" }));
  const [editing, setEditing] = useState<SubscriptionDraft | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: trpc.events.subscriptions.pathKey() });

  const setStatus = useMutation(
    trpc.events.subscriptions.setStatus.mutationOptions({ onSuccess: refresh }),
  );

  const remove = useMutation(
    trpc.events.subscriptions.remove.mutationOptions({ onSuccess: refresh }),
  );

  const sendTest = useMutation(
    trpc.events.subscriptions.sendTest.mutationOptions({ onSuccess: (_, v) => setSent(v.id) }),
  );

  const provider = list.data?.chatProvider;
  const connected = provider && provider !== "Test chat";
  const error = setStatus.error ?? remove.error ?? sendTest.error;

  return (
    <Panel
      title="Slack"
      description="Post events to team channels, each with a link back to the record."
      action={
        <Button
          variant="outline"
          size="sm"
          onClick={() => setEditing(emptyDraft(["quote.referred", "payment.failed"]))}
        >
          <Plus /> Add destination
        </Button>
      }
      flush
    >
      {list.data && !connected && (
        <div className="border-b px-(--card-p) py-3 text-sm text-muted-foreground">
          <span className="mr-2 inline-block size-1.5 rounded-full bg-amber-500 align-middle" />
          Slack isn't connected, so messages only reach the test channel.{" "}
          <Link
            to="/settings/integrations/$providerId"
            params={{ providerId: "slack" }}
            className="font-medium text-foreground underline-offset-2 hover:underline"
          >
            Connect Slack
          </Link>
        </div>
      )}
      {error && (
        <div className="border-b p-(--card-p)">
          <Notice tone="error" title="Couldn't update the destination">
            {error.message}
          </Notice>
        </div>
      )}
      {!list.data ? (
        <div className="h-24 animate-pulse bg-muted/30" />
      ) : list.data.subscriptions.length === 0 ? (
        <EmptyState
          icon={<MessageSquare />}
          title="No Slack destinations"
          description="Add one to post referrals, failed payments or cancellations to a channel."
        />
      ) : (
        <ul className="m-0 list-none divide-y p-0">
          {list.data.subscriptions.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-4 px-(--card-p) py-3.5">
              <span className="grid min-w-0 gap-0.5">
                <span className="truncate text-sm leading-5 font-medium">{s.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {describePatterns(s.eventTypes, catalog.data?.types ?? [])}
                  {s.filter && " · filtered"}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {sent === s.id && <span className="text-xs text-muted-foreground">Test sent</span>}
                {s.status === "disabled" ? (
                  <StatusChip tone="danger">Disabled</StatusChip>
                ) : s.failingSince ? (
                  <StatusChip tone="warning">Failing</StatusChip>
                ) : (
                  <StatusChip tone="success">Active</StatusChip>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label={`Actions for ${s.name}`}>
                      <Ellipsis />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem onSelect={() => setEditing(draftOf(s))}>
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={s.status === "disabled"}
                      onSelect={() =>
                        sendTest.mutate({
                          id: s.id,
                          type:
                            catalog.data?.types.find((t) =>
                              s.eventTypes.some(
                                (p) =>
                                  p === "*" ||
                                  p === t.type ||
                                  (p.endsWith(".*") && t.type.startsWith(p.slice(0, -1))),
                              ),
                            )?.type ?? "",
                        })
                      }
                    >
                      Send test message
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() =>
                        setStatus.mutate({ id: s.id, active: s.status === "disabled" })
                      }
                    >
                      {s.status === "disabled" ? "Enable" : "Disable"}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={() => remove.mutate({ id: s.id })}
                    >
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </span>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-xl">
          {editing && (
            <SubscriptionForm
              kind="chat"
              initial={editing}
              onDone={async () => {
                await refresh();
                setEditing(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
