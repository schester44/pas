import type { SchemaNode } from "@pas/forms-core";
import { Button } from "@pas/ui/components/button";
import { EmptyState } from "@pas/ui/components/empty-state";
import { PageBody } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pas/ui/components/table";
import { cn } from "@pas/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, MapPin, Plus } from "lucide-react";
import { useState } from "react";
import { AvailabilityDialog } from "@/components/catalog/availability-dialog";
import { useVersionEditor } from "@/components/catalog/version-editor";
import { formatDate, formatDateWindow, formatRelative } from "@/lib/format";
import { jurisdictionCode, jurisdictionName, jurisdictionShort } from "@pas/ui/lib/jurisdictions";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/products/$productId/versions/$versionId/")({
  validateSearch: (search: Record<string, unknown>): { jurisdiction?: string } =>
    typeof search.jurisdiction === "string" ? { jurisdiction: search.jurisdiction } : {},
  component: OverviewTab,
});

function countFields(nodes: readonly SchemaNode[]): number {
  return nodes.reduce(
    (sum, node) => sum + ("children" in node ? countFields(node.children) : 1),
    0,
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function OverviewTab() {
  return (
    <PageBody className="max-w-6xl">
      <Summary />
      <Availability />
    </PageBody>
  );
}

function Summary() {
  const trpc = useTRPC();
  const { version, contents } = useVersionEditor();

  const versions = useQuery(
    trpc.catalog.versions.list.queryOptions({ productId: version.productId }),
  );

  const basedOn = versions.data?.find((v) => v.id === version.basedOnId);
  const params = { productId: version.productId, versionId: version.id };

  const stats = [
    {
      label: "Risk data",
      value: plural(countFields(contents.riskSchema.fields), "field"),
      to: "/products/$productId/versions/$versionId/risk",
    },
    {
      label: "Questions",
      value: plural(contents.forms.length, "question set"),
      to: "/products/$productId/versions/$versionId/questions",
    },
    {
      label: "Coverages",
      value: plural(contents.coverages.length, "coverage"),
      to: "/products/$productId/versions/$versionId/coverages",
    },
    {
      label: "Documents",
      value: plural(contents.documents.templates.length, "template"),
      to: "/products/$productId/versions/$versionId/documents",
    },
    {
      label: "Availability",
      value: plural(contents.availability.length, "jurisdiction"),
      to: "/products/$productId/versions/$versionId",
    },
  ] as const;

  const meta = [
    basedOn && (
      <>
        Copied from{" "}
        <Link
          to="/products/$productId/versions/$versionId"
          params={{ productId: version.productId, versionId: basedOn.id }}
          className="font-medium text-foreground tabular-nums hover:underline"
        >
          {basedOn.version}
        </Link>
      </>
    ),
    `Created ${formatDate(version.createdAt)}`,
    version.publishedAt
      ? `Published ${formatDate(version.publishedAt)}`
      : `Updated ${formatRelative(version.updatedAt)}`,
    version.retiredAt && `Retired ${formatDate(version.retiredAt)}`,
  ].filter(Boolean);

  return (
    <Panel
      flush
      footer={
        <p className="m-0 flex flex-wrap gap-x-2 text-xs text-muted-foreground tabular-nums">
          {meta.map((item, i) => (
            <span key={i} className="flex gap-2">
              {i > 0 && <span aria-hidden>·</span>}
              {item}
            </span>
          ))}
        </p>
      }
    >
      <dl className="m-0 grid grid-cols-2 lg:grid-cols-4">
        {stats.map((stat, i) => (
          <Link
            key={stat.label}
            to={stat.to}
            params={params}
            className={cn(
              "group grid gap-1 px-(--card-p) py-5 outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/40",
              i % 2 === 1 && "border-l",
              i >= 2 && "border-t lg:border-t-0",
              i === 2 && "lg:border-l",
            )}
          >
            <dt className="text-sm text-muted-foreground">{stat.label}</dt>
            <dd className="m-0 text-xl leading-7 font-semibold tracking-tight tabular-nums">
              {stat.value}
            </dd>
          </Link>
        ))}
      </dl>
    </Panel>
  );
}

function Availability() {
  const { contents, readOnly, set } = useVersionEditor();
  const { jurisdiction: highlighted } = Route.useSearch();
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const windows = contents.availability;
  const current = typeof editing === "number" ? windows[editing] : undefined;

  const taken = windows
    .filter((_, i) => i !== editing)
    .map((w) => jurisdictionCode(w.jurisdiction));

  const save = (next: typeof windows) => set("availability", next, true);

  const addAction = !readOnly && (
    <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
      <Plus /> Add jurisdiction
    </Button>
  );

  return (
    <Panel
      title="Availability"
      description="Where this version is sold and which effective dates it covers."
      action={windows.length > 0 && addAction}
      flush
    >
      {windows.length === 0 ? (
        <EmptyState
          icon={<MapPin />}
          title="Not available anywhere yet"
          description="Add a jurisdiction to choose where and when this version can be quoted."
          action={addAction}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Jurisdiction</TableHead>
              <TableHead>New business</TableHead>
              <TableHead>Renewal</TableHead>
              {!readOnly && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {windows.map((window, i) => {
              const code = jurisdictionCode(window.jurisdiction);

              return (
                <TableRow
                  key={code + i}
                  className={cn(
                    !readOnly && "cursor-pointer hover:bg-muted/40",
                    highlighted === code && "bg-primary/5",
                  )}
                  onClick={readOnly ? undefined : () => setEditing(i)}
                >
                  <TableCell>
                    <span className="flex items-baseline gap-2">
                      <span className="font-medium">{jurisdictionName(window.jurisdiction)}</span>
                      <span className="text-xs text-muted-foreground">
                        {jurisdictionShort(window.jurisdiction)}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatDateWindow(window.newBusiness)}
                  </TableCell>
                  <TableCell className="tabular-nums">{formatDateWindow(window.renewal)}</TableCell>
                  {!readOnly && (
                    <TableCell className="text-right text-muted-foreground">
                      <ChevronRight aria-hidden className="ml-auto size-4" />
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      <AvailabilityDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        window={current}
        taken={taken}
        onSave={(window) =>
          save(
            typeof editing === "number"
              ? windows.map((w, i) => (i === editing ? window : w))
              : [...windows, window],
          )
        }
        onRemove={
          typeof editing === "number"
            ? () => save(windows.filter((_, i) => i !== editing))
            : undefined
        }
      />
    </Panel>
  );
}
