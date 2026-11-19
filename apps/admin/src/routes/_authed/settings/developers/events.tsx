import { PageBody, PageHeader } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import { Notice } from "@pas/ui/components/notice";
import { SegmentedControl } from "@pas/ui/components/segmented-control";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import {
  type CatalogType,
  Code,
  GROUP_LABELS,
  groupTypes,
  useEventCatalog,
} from "@/components/events/subscriptions";

export const Route = createFileRoute("/_authed/settings/developers/events")({
  component: EventCatalogPage,
});

function EventCatalogPage() {
  const catalog = useEventCatalog();

  return (
    <>
      <PageHeader title="Event catalog" />
      <PageBody className="max-w-4xl gap-8">
        <section className="grid gap-1">
          <p className="m-0 text-sm text-muted-foreground">
            Version{" "}
            <span className="font-mono text-foreground tabular-nums">{catalog.data?.version}</span>.
            Every delivery is a JSON envelope with an <code>id</code> (use it as the idempotency
            key), <code>type</code>, <code>apiVersion</code>, <code>createdAt</code>,{" "}
            <code>environment</code> and <code>data</code>, signed in the <code>Pas-Signature</code>{" "}
            header. Payload shapes only change in a new version.
          </p>
        </section>
        {catalog.error && (
          <Notice tone="error" title="Couldn't load the catalog">
            {catalog.error.message}
          </Notice>
        )}
        {!catalog.data
          ? Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="h-48 animate-pulse rounded-xl border bg-card" />
            ))
          : groupTypes(catalog.data.types).map(({ group, items }) => (
              <Panel key={group} title={GROUP_LABELS[group] ?? group} flush>
                <ul className="m-0 list-none divide-y p-0">
                  {items.map((item) => (
                    <EventTypeRow key={item.type} item={item} />
                  ))}
                </ul>
              </Panel>
            ))}
      </PageBody>
    </>
  );
}

function EventTypeRow({ item }: { item: CatalogType }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"sample" | "schema">("sample");

  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-3 px-(--card-p) py-3.5 text-left outline-none hover:bg-muted/40 focus-visible:bg-muted/40"
      >
        <ChevronRight
          aria-hidden
          className={`mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
        />
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="text-sm leading-5 font-medium">{item.title}</span>
            <code className="font-mono text-xs text-muted-foreground">{item.type}</code>
          </span>
          <span className="text-sm text-muted-foreground">{item.description}</span>
        </span>
      </button>
      {open && (
        <div className="grid gap-3 px-(--card-p) pb-4 pl-[calc(var(--card-p)+1.75rem)]">
          <SegmentedControl
            label="Show"
            value={view}
            onValueChange={setView}
            className="justify-self-start"
            options={[
              { value: "sample", label: "Sample payload" },
              { value: "schema", label: "Data schema" },
            ]}
          />
          <Code>{JSON.stringify(view === "sample" ? item.sample : item.schema, null, 2)}</Code>
        </div>
      )}
    </li>
  );
}
