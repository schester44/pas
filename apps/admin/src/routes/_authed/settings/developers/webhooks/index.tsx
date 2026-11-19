import { Button } from "@pas/ui/components/button";
import { Dialog, DialogContent } from "@pas/ui/components/dialog";
import { EmptyState } from "@pas/ui/components/empty-state";
import { Notice } from "@pas/ui/components/notice";
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import { StatusChip } from "@pas/ui/components/status-chip";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Plus, Webhook } from "lucide-react";
import { useState } from "react";
import {
  describePatterns,
  emptyDraft,
  SecretReveal,
  SubscriptionForm,
  useEventCatalog,
} from "@/components/events/subscriptions";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/settings/developers/webhooks/")({
  component: WebhooksPage,
});

function WebhooksPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const list = useQuery(trpc.events.subscriptions.list.queryOptions({ kind: "webhook" }));
  const catalog = useEventCatalog();
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ id: string; secret: string } | null>(null);
  const webhooks = list.data?.subscriptions ?? [];

  return (
    <>
      <PageHeader
        title="Webhooks"
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> Add endpoint
          </Button>
        }
      />
      <PageBody className="max-w-4xl">
        {list.data?.sandbox && (
          <Notice title="Sandbox events">
            Endpoints here receive this sandbox's events only, marked{" "}
            <code>"environment": "sandbox"</code>, and may use http and localhost URLs.
          </Notice>
        )}
        {list.error && (
          <Notice tone="error" title="Couldn't load webhooks">
            {list.error.message}
          </Notice>
        )}
        <Panel
          title="Endpoints"
          description="Signed event deliveries to your systems, retried with backoff for 24 hours."
          action={
            <Button variant="ghost" size="sm" asChild>
              <Link to="/settings/developers/events">
                Event catalog <ArrowRight />
              </Link>
            </Button>
          }
          flush
        >
          {!list.data ? (
            <div className="divide-y">
              {Array.from({ length: 2 }, (_, i) => (
                <div key={i} className="h-[68px] animate-pulse bg-muted/30" />
              ))}
            </div>
          ) : webhooks.length === 0 ? (
            <EmptyState
              icon={<Webhook />}
              title="No endpoints yet"
              description="Add an endpoint to receive quote, policy and billing events as they happen."
            />
          ) : (
            <ul className="m-0 list-none divide-y p-0">
              {webhooks.map((w) => (
                <li key={w.id}>
                  <Link
                    to="/settings/developers/webhooks/$subscriptionId"
                    params={{ subscriptionId: w.id }}
                    className="flex items-center justify-between gap-4 px-(--card-p) py-3.5 outline-none hover:bg-muted/40 focus-visible:bg-muted/40"
                  >
                    <span className="grid min-w-0 gap-0.5">
                      <span className="truncate text-sm leading-5 font-medium">{w.name}</span>
                      <span className="truncate font-mono text-xs text-muted-foreground">
                        {w.url}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {describePatterns(w.eventTypes, catalog.data?.types ?? [])}
                        {w.filter && " · filtered"}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      {w.status === "disabled" ? (
                        <StatusChip tone="danger">Disabled</StatusChip>
                      ) : w.failingSince ? (
                        <StatusChip tone="warning">Failing</StatusChip>
                      ) : (
                        <StatusChip tone="success">Active</StatusChip>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </PageBody>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-xl">
          {creating && (
            <SubscriptionForm
              kind="webhook"
              initial={emptyDraft()}
              onDone={async ({ id, secret }) => {
                await queryClient.invalidateQueries({
                  queryKey: trpc.events.subscriptions.pathKey(),
                });

                setCreating(false);
                setCreated(secret ? { id, secret } : null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={created !== null}
        onOpenChange={(open) => {
          if (open || !created) return;

          void navigate({
            to: "/settings/developers/webhooks/$subscriptionId",
            params: { subscriptionId: created.id },
          });

          setCreated(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          {created && <SecretReveal secret={created.secret} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
