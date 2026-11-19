import type { AdminOutputs } from "@pas/api-client";
import { Button } from "@pas/ui/components/button";
import { Checkbox } from "@pas/ui/components/checkbox";
import {
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@pas/ui/components/dialog";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { Notice } from "@pas/ui/components/notice";
import { Spinner } from "@pas/ui/components/spinner";
import type { StatusTone } from "@pas/ui/components/status-chip";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { useState } from "react";
import { CopyButton } from "@/components/copy-button";
import { useTRPC } from "@/lib/trpc";

export type CatalogType = AdminOutputs["events"]["catalog"]["types"][number];
export type SubscriptionDto = AdminOutputs["events"]["subscriptions"]["get"]["subscription"];

export const GROUP_LABELS: Record<string, string> = {
  submission: "Submissions",
  quote: "Quotes",
  policy: "Policies",
  invoice: "Invoices",
  payment: "Payments",
  obligation: "Obligations",
  filing: "Filings",
};

export const DELIVERY_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  pending: { label: "Pending", tone: "neutral" },
  retrying: { label: "Retrying", tone: "warning" },
  succeeded: { label: "Delivered", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
};

export function useEventCatalog() {
  const trpc = useTRPC();

  return useQuery({ ...trpc.events.catalog.queryOptions(), staleTime: Infinity });
}

export function groupTypes(types: readonly CatalogType[]) {
  const groups = new Map<string, CatalogType[]>();

  for (const type of types) groups.set(type.group, [...(groups.get(type.group) ?? []), type]);

  return [...groups.entries()].map(([group, items]) => ({ group, items }));
}

/** "All policy events, Quote bound" for a list of patterns. */
export function describePatterns(patterns: readonly string[], types: readonly CatalogType[]) {
  return patterns
    .map((pattern) => {
      if (pattern === "*") return "All events";

      if (pattern.endsWith(".*")) return `All ${pattern.slice(0, -2)} events`;

      return types.find((t) => t.type === pattern)?.title ?? pattern;
    })
    .join(", ");
}

function EventTypePicker({
  value,
  onChange,
  types,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  types: readonly CatalogType[];
}) {
  const toggle = (pattern: string, on: boolean, drop: (p: string) => boolean = () => false) =>
    onChange([...value.filter((p) => p !== pattern && !drop(p)), ...(on ? [pattern] : [])]);

  return (
    <div className="grid max-h-72 gap-4 overflow-y-auto rounded-lg border p-3">
      {groupTypes(types).map(({ group, items }) => {
        const wildcard = `${group}.*`;
        const all = value.includes(wildcard) || value.includes("*");

        return (
          <fieldset key={group} className="m-0 grid gap-2 border-0 p-0">
            <label className="flex items-center gap-2.5 text-sm font-medium">
              <Checkbox
                checked={all}
                disabled={value.includes("*")}
                onCheckedChange={(on) =>
                  toggle(wildcard, on === true, (p) => p.startsWith(`${group}.`))
                }
              />
              {GROUP_LABELS[group] ?? group}
              <span className="font-mono text-xs font-normal text-muted-foreground">
                {wildcard}
              </span>
            </label>
            <div className="grid gap-1.5 pl-6.5 sm:grid-cols-2">
              {items.map((item) => (
                <label key={item.type} className="flex items-center gap-2.5 text-sm">
                  <Checkbox
                    checked={all || value.includes(item.type)}
                    disabled={all}
                    onCheckedChange={(on) => toggle(item.type, on === true)}
                  />
                  {item.title}
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

export interface SubscriptionDraft {
  id?: string;
  name: string;
  url: string;
  eventTypes: string[];
  filter: string;
}

export const emptyDraft = (eventTypes: string[] = []): SubscriptionDraft => ({
  name: "",
  url: "",
  eventTypes,
  filter: "",
});

export const draftOf = (s: SubscriptionDto): SubscriptionDraft => ({
  id: s.id,
  name: s.name,
  url: s.url ?? "",
  eventTypes: s.eventTypes,
  filter: s.filter ?? "",
});

/** Create or edit a webhook or chat destination. */
export function SubscriptionForm({
  kind,
  initial,
  onDone,
}: {
  kind: "webhook" | "chat";
  initial: SubscriptionDraft;
  onDone: (result: { id: string; secret: string | null }) => void;
}) {
  const trpc = useTRPC();
  const catalog = useEventCatalog();
  const [draft, setDraft] = useState(initial);
  const [submitted, setSubmitted] = useState(false);
  const create = useMutation(trpc.events.subscriptions.create.mutationOptions());
  const update = useMutation(trpc.events.subscriptions.update.mutationOptions());
  const set = (patch: Partial<SubscriptionDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const error = create.error ?? update.error;
  const busy = create.isPending || update.isPending;
  const noun = kind === "webhook" ? "endpoint" : "Slack destination";

  const missing = {
    name: !draft.name.trim(),
    url: kind === "webhook" && !draft.url.trim(),
    events: draft.eventTypes.length === 0,
  };

  return (
    <form
      className="grid gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);

        if (missing.name || missing.url || missing.events) return;

        const input = {
          name: draft.name,
          url: kind === "webhook" ? draft.url.trim() : null,
          eventTypes: draft.eventTypes,
          filter: draft.filter.trim() || null,
        };

        if (draft.id) {
          update.mutate(
            { ...input, id: draft.id },
            { onSuccess: () => onDone({ id: draft.id!, secret: null }) },
          );
        } else {
          create.mutate({ ...input, kind }, { onSuccess: onDone });
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>{draft.id ? `Edit ${initial.name}` : `Add ${noun}`}</DialogTitle>
        <DialogDescription>
          {kind === "webhook"
            ? "We POST each matching event to this URL, signed with HMAC-SHA256."
            : "Each matching event posts a short message with a link back to admin."}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="subscription-name">Name</Label>
          <Input
            id="subscription-name"
            value={draft.name}
            placeholder={kind === "webhook" ? "Agency management system" : "#underwriting"}
            onChange={(e) => set({ name: e.target.value })}
          />
          {submitted && missing.name && (
            <p className="m-0 text-xs text-destructive">Name the {noun}.</p>
          )}
        </div>
        {kind === "webhook" && (
          <div className="grid gap-2">
            <Label htmlFor="subscription-url">Endpoint URL</Label>
            <Input
              id="subscription-url"
              value={draft.url}
              placeholder="https://example.com/webhooks/pas"
              className="font-mono text-[13px]"
              onChange={(e) => set({ url: e.target.value })}
            />
            {submitted && missing.url && (
              <p className="m-0 text-xs text-destructive">Enter the URL to deliver to.</p>
            )}
          </div>
        )}
        <div className="grid gap-2">
          <Label>Events</Label>
          {catalog.data ? (
            <EventTypePicker
              value={draft.eventTypes}
              onChange={(eventTypes) => set({ eventTypes })}
              types={catalog.data.types}
            />
          ) : (
            <div className="h-72 animate-pulse rounded-lg border bg-muted/40" />
          )}
          {submitted && missing.events && (
            <p className="m-0 text-xs text-destructive">Choose at least one event.</p>
          )}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="subscription-filter">
            Filter <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="subscription-filter"
            value={draft.filter}
            placeholder='product == "homeowners" and premium > 5000'
            className="font-mono text-[13px]"
            onChange={(e) => set({ filter: e.target.value })}
          />
          <p className="m-0 text-xs text-muted-foreground">
            An expression over <code>product</code>, <code>premium</code>, <code>jurisdiction</code>
            , <code>producer</code>, <code>type</code> and the full <code>data</code>.
          </p>
        </div>
      </div>
      {error && (
        <Notice tone="error" title="Couldn't save">
          {error.message}
        </Notice>
      )}
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={busy}>
          {busy && <Spinner />}
          {draft.id ? "Save changes" : `Add ${noun}`}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** The signing secret, shown exactly once after creating or rotating. */
export function SecretReveal({ secret, rotated }: { secret: string; rotated?: boolean }) {
  return (
    <div className="grid gap-6">
      <DialogHeader>
        <DialogTitle>{rotated ? "New signing secret" : "Signing secret"}</DialogTitle>
        <DialogDescription>
          Copy it now; it won't be shown again.
          {rotated && " The previous secret keeps signing for 24 hours alongside this one."}
        </DialogDescription>
      </DialogHeader>
      <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-2 pl-3">
        <code className="min-w-0 flex-1 truncate font-mono text-[13px]">{secret}</code>
        <CopyButton value={secret} icon={<Copy />} />
      </div>
      <p className="m-0 text-sm text-muted-foreground">
        Verify the <code>Pas-Signature</code> header: an HMAC-SHA256 of <code>{"{t}.{body}"}</code>{" "}
        with this secret.
      </p>
      <DialogFooter>
        <DialogClose asChild>
          <Button>Done</Button>
        </DialogClose>
      </DialogFooter>
    </div>
  );
}

export function Code({ children }: { children: string }) {
  return (
    <pre className="m-0 max-h-80 overflow-auto rounded-lg bg-muted/50 p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-all">
      {children}
    </pre>
  );
}
