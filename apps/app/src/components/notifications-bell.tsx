import type { AppOutputs } from "@pas/api-client";
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
import { Notice } from "@pas/ui/components/notice";
import { Popover, PopoverContent, PopoverTrigger } from "@pas/ui/components/popover";
import { Spinner } from "@pas/ui/components/spinner";
import { cn } from "@pas/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { useState } from "react";
import { formatRelative } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";

type Item = AppOutputs["notifications"]["feed"]["items"][number];

/** Producers' bell: their own book's referrals, approvals, failed payments and cancellations. */
export function NotificationsBell() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(false);

  const feed = useQuery({
    ...trpc.notifications.feed.queryOptions({ limit: 20 }),
    refetchInterval: 30_000,
    retry: false,
  });

  const markRead = useMutation(
    trpc.notifications.markRead.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.notifications.pathKey() }),
    }),
  );

  if (feed.error) return null;

  const unread = feed.data?.unread ?? 0;

  const openItem = (item: Item) => {
    if (!item.read) markRead.mutate({ ids: [item.id] });

    setOpen(false);

    if (item.subject?.kind === "submission") {
      void navigate({
        to: "/submissions/$submissionId",
        params: { submissionId: item.subject.id },
      });
    } else if (item.subject?.kind === "policy") {
      void navigate({ to: "/policies/$policyId", params: { policyId: item.subject.id } });
    }
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
          className="relative flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:bg-muted"
        >
          <Bell className="size-4" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground tabular-nums ring-2 ring-background">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[22rem] p-0">
          <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
            <p className="m-0 text-sm font-semibold">Notifications</p>
            {unread > 0 && (
              <button
                type="button"
                className="text-xs font-medium text-primary hover:underline"
                onClick={() => markRead.mutate({ ids: "all" })}
              >
                Mark all read
              </button>
            )}
          </div>
          {!feed.data ? (
            <div className="h-32 animate-pulse bg-muted/30" />
          ) : feed.data.items.length === 0 ? (
            <p className="m-0 px-4 py-10 text-center text-sm text-muted-foreground">
              You're all caught up.
            </p>
          ) : (
            <ul className="m-0 max-h-[24rem] list-none divide-y overflow-y-auto p-0">
              {feed.data.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => openItem(item)}
                    className={cn(
                      "flex w-full gap-3 px-4 py-3 text-left outline-none hover:bg-muted/50 focus-visible:bg-muted/50",
                      !item.read && "bg-primary/5",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "mt-1.5 size-1.5 shrink-0 rounded-full",
                        item.read ? "bg-transparent" : "bg-primary",
                      )}
                    />
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="text-sm leading-5 font-medium">{item.title}</span>
                      {item.body && (
                        <span className="line-clamp-2 text-xs text-muted-foreground">
                          {item.body}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {formatRelative(item.createdAt)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t px-4 py-2.5">
            <button
              type="button"
              className="text-xs font-medium text-muted-foreground hover:text-foreground"
              onClick={() => {
                setOpen(false);
                setSettings(true);
              }}
            >
              Notification settings
            </button>
          </div>
        </PopoverContent>
      </Popover>
      <Dialog open={settings} onOpenChange={setSettings}>
        <DialogContent className="sm:max-w-md">
          {settings && <Preferences onDone={() => setSettings(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Preferences({ onDone }: { onDone: () => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const preferences = useQuery(trpc.notifications.preferences.queryOptions());
  const [chosen, setChosen] = useState<Set<string> | null>(null);

  const enabled =
    chosen ?? new Set(preferences.data?.types.filter((t) => t.enabled).map((t) => t.type));

  const save = useMutation(
    trpc.notifications.setPreferences.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: trpc.notifications.pathKey() });
        onDone();
      },
    }),
  );

  return (
    <form
      className="grid gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ eventTypes: [...enabled] });
      }}
    >
      <DialogHeader>
        <DialogTitle>Notifications</DialogTitle>
        <DialogDescription>Choose what you hear about for your own business.</DialogDescription>
      </DialogHeader>
      {!preferences.data ? (
        <div className="h-48 animate-pulse rounded-lg bg-muted/40" />
      ) : (
        <div className="grid gap-2.5">
          {preferences.data.types.map((t) => (
            <label key={t.type} className="flex items-start gap-2.5 text-sm">
              <Checkbox
                className="mt-0.5"
                checked={enabled.has(t.type)}
                onCheckedChange={(on) => {
                  const next = new Set(enabled);

                  if (on === true) next.add(t.type);
                  else next.delete(t.type);

                  setChosen(next);
                }}
              />
              <span className="grid gap-0.5">
                <span className="font-medium">{t.title}</span>
                <span className="text-xs text-muted-foreground">{t.description}</span>
              </span>
            </label>
          ))}
        </div>
      )}
      {save.error && (
        <Notice tone="error" title="Couldn't save">
          {save.error.message}
        </Notice>
      )}
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={!chosen || save.isPending}>
          {save.isPending && <Spinner />}
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}
