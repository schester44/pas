import type { AdminOutputs } from "@pas/api-client";
import { Popover, PopoverContent, PopoverTrigger } from "@pas/ui/components/popover";
import { cn } from "@pas/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { useState } from "react";
import { formatRelative } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";

type Item = AdminOutputs["notifications"]["feed"]["items"][number];

/** The sidebar bell: unread count, the latest notifications, mark read. */
export function NotificationsBell() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const feed = useQuery({
    ...trpc.notifications.feed.queryOptions({ limit: 20 }),
    refetchInterval: 30_000,
  });

  const markRead = useMutation(
    trpc.notifications.markRead.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.notifications.pathKey() }),
    }),
  );

  const unread = feed.data?.unread ?? 0;

  const openItem = (item: Item) => {
    if (!item.read) markRead.mutate({ ids: [item.id] });

    setOpen(false);

    const subject = item.subject;

    if (subject?.kind === "submission") {
      void navigate({ to: "/submissions/$submissionId", params: { submissionId: subject.id } });
    } else if (subject?.kind === "policy") {
      void navigate({ to: "/policies/$policyId", params: { policyId: subject.id } });
    } else if (subject?.kind === "obligation") {
      void navigate({ to: "/compliance/$obligationId", params: { obligationId: subject.id } });
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="flex h-8 items-center gap-2.5 rounded-md px-2 text-sm text-muted-foreground transition-colors outline-none hover:bg-black/[0.03] hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:bg-black/[0.03] data-[state=open]:text-foreground">
        <Bell aria-hidden className="size-4 shrink-0" />
        <span className="flex-1 text-left">Notifications</span>
        {unread > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground tabular-nums">
            <span className="sr-only">Unread: </span>
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" side="right" className="w-96 p-0">
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
          <div className="h-40 animate-pulse bg-muted/30" />
        ) : feed.data.items.length === 0 ? (
          <p className="m-0 px-4 py-10 text-center text-sm text-muted-foreground">
            You're all caught up.
          </p>
        ) : (
          <ul className="m-0 max-h-[26rem] list-none divide-y overflow-y-auto p-0">
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
          <Link
            to="/settings/notifications"
            onClick={() => setOpen(false)}
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Notification settings
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
