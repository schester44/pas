import type { RiskSchema, SchemaNode } from "@pas/forms-core";
import { Button } from "@pas/ui/components/button";
import { Card } from "@pas/ui/components/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@pas/ui/components/dropdown-menu";
import { EmptyState } from "@pas/ui/components/empty-state";
import { Tree, type TreeRow } from "@pas/ui/components/tree";
import { cn } from "@pas/ui/lib/utils";
import { Folder, ListTree, Plus, Rows3, Type } from "lucide-react";
import { useMemo, useState } from "react";
import { ConfirmDelete } from "./confirm-delete";
import { FIELD_LIBRARY } from "./field-library";
import { PaneHeader } from "./inspector";
import { KIND_META } from "./kinds";
import { SchemaInspector } from "./schema-inspector";
import {
  countDescendants,
  insertAt,
  insertionPoint,
  isContainer,
  moveAt,
  type NodePath,
  nodeAt,
  parsePathId,
  pathId,
  pathsWithProblems,
  removeAt,
  siblingsAt,
  uniqueKey,
  updateAt,
} from "./schema-tree";

export interface RiskSchemaBuilderProps {
  value: RiskSchema;
  onChange: (next: RiskSchema) => void;
  readOnly?: boolean;
}

const BLANKS: { label: string; icon: typeof Type; make: () => SchemaNode }[] = [
  {
    label: "Field",
    icon: Type,
    make: () => ({ key: "newField", kind: "text", label: "New field" }),
  },
  {
    label: "Group",
    icon: Folder,
    make: () => ({ key: "newGroup", kind: "group", label: "New group", children: [] }),
  },
  {
    label: "Repeatable",
    icon: Rows3,
    make: () => ({ key: "newList", kind: "repeatable", label: "New list", children: [] }),
  },
];

// Collapse follows the node through reorders, so it's keyed by schema keys rather than position.
function keyId(nodes: SchemaNode[], path: NodePath): string {
  return path.map((_, depth) => nodeAt(nodes, path.slice(0, depth + 1))?.key ?? "").join("/");
}

export function RiskSchemaBuilder({ value, onChange, readOnly }: RiskSchemaBuilderProps) {
  const nodes = value.fields;
  const [selected, setSelected] = useState<NodePath | undefined>(nodes.length ? [0] : undefined);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [deleting, setDeleting] = useState<NodePath>();
  const node = selected ? nodeAt(nodes, selected) : undefined;
  const commit = (fields: SchemaNode[]) => onChange({ ...value, fields });
  const flagged = useMemo(() => pathsWithProblems(nodes), [nodes]);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      const key = keyId(nodes, parsePathId(id));

      if (!next.delete(key)) next.add(key);

      return next;
    });

  const add = (make: () => SchemaNode) => {
    const { parent, index } = insertionPoint(nodes, selected);
    const created = make();
    const siblings = parent.length ? siblingsAt(nodes, [...parent, 0]) : nodes;
    commit(insertAt(nodes, parent, index, [{ ...created, key: uniqueKey(siblings, created.key) }]));
    setSelected([...parent, index]);

    setCollapsed((prev) => {
      const next = new Set(prev);
      next.delete(keyId(nodes, parent));

      return next;
    });
  };

  const move = (path: NodePath, delta: -1 | 1) => {
    const moved = moveAt(nodes, path, delta);

    if (!moved) return;

    commit(moved.nodes);
    setSelected(moved.path);
  };

  const duplicate = (path: NodePath) => {
    const original = nodeAt(nodes, path)!;
    const copy = structuredClone(original);
    copy.key = uniqueKey(siblingsAt(nodes, path), `${original.key}Copy`);
    copy.label = `${original.label} copy`;
    const index = path.at(-1)! + 1;
    commit(insertAt(nodes, path.slice(0, -1), index, [copy]));
    setSelected([...path.slice(0, -1), index]);
  };

  const remove = (path: NodePath) => {
    const next = removeAt(nodes, path);
    commit(next);
    const index = path.at(-1)!;
    const parent = path.slice(0, -1);
    const remaining = parent.length ? siblingsAt(next, [...parent, 0]) : next;

    setSelected(
      remaining.length
        ? [...parent, Math.min(index, remaining.length - 1)]
        : parent.length
          ? parent
          : undefined,
    );
  };

  const rows = useMemo(() => {
    const out: TreeRow[] = [];

    const walk = (list: SchemaNode[], prefix: number[], keys: string) =>
      list.forEach((child, i) => {
        const path = [...prefix, i];
        const id = pathId(path);
        const key = keys ? `${keys}/${child.key}` : child.key;
        const open = !collapsed.has(key);

        out.push({
          id,
          depth: prefix.length,
          label: child.label || child.key,
          expanded: isContainer(child) ? open : undefined,
          content: <SchemaRow node={child} flagged={flagged.has(id)} />,
        });

        if (isContainer(child) && open) walk(child.children, path, key);
      });

    walk(nodes, [], "");

    return out;
  }, [nodes, collapsed, flagged]);

  const deletingNode = deleting ? nodeAt(nodes, deleting) : undefined;
  const nested = deletingNode ? countDescendants(deletingNode) : 0;

  return (
    <Card className="grid min-h-[36rem] overflow-hidden lg:grid-cols-[19rem_minmax(0,1fr)]">
      <div className="flex min-h-0 flex-col border-b bg-muted/30 lg:border-r lg:border-b-0">
        <PaneHeader title="Risk data">
          {!readOnly && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Plus /> Add
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80">
                {BLANKS.map((blank) => (
                  <DropdownMenuItem key={blank.label} onSelect={() => add(blank.make)}>
                    <blank.icon /> {blank.label}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>From library</DropdownMenuLabel>
                {FIELD_LIBRARY.map((preset) => {
                  const Icon = KIND_META[preset.node.kind].icon;

                  return (
                    <DropdownMenuItem
                      key={preset.id}
                      className="items-start"
                      onSelect={() => add(() => structuredClone(preset.node))}
                    >
                      <Icon className="mt-0.5 shrink-0" />
                      <span className="grid gap-0.5">
                        <span>{preset.label}</span>
                        <span className="text-xs text-muted-foreground">{preset.description}</span>
                      </span>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </PaneHeader>
        {rows.length > 0 ? (
          <Tree
            label="Risk schema"
            rows={rows}
            selectedId={selected ? pathId(selected) : undefined}
            onSelect={(id) => setSelected(parsePathId(id))}
            onToggle={toggle}
            onMove={readOnly ? undefined : (id, delta) => move(parsePathId(id), delta)}
            className="max-h-[44rem] overflow-y-auto"
          />
        ) : (
          <p className="m-0 px-4 py-6 text-sm text-muted-foreground">No fields yet.</p>
        )}
      </div>
      <div className="min-w-0">
        {node && selected ? (
          <SchemaInspector
            key={pathId(selected)}
            nodes={nodes}
            path={selected}
            readOnly={readOnly}
            onChange={(next) => commit(updateAt(nodes, selected, () => next))}
            onMove={(delta) => move(selected, delta)}
            onDuplicate={() => duplicate(selected)}
            onDelete={() => setDeleting(selected)}
          />
        ) : (
          <EmptyState
            icon={<ListTree />}
            title={nodes.length ? "Select a field" : "No risk data yet"}
            description={
              nodes.length
                ? "Pick a field, group or repeatable to see its definition."
                : readOnly
                  ? undefined
                  : "Add fields, or start from the library."
            }
            className="py-24"
          />
        )}
      </div>
      <ConfirmDelete
        open={deleting !== undefined}
        onOpenChange={(open) => !open && setDeleting(undefined)}
        title={`Delete ${deletingNode?.label || deletingNode?.key || "field"}?`}
        description={
          nested > 0
            ? `This also deletes the ${nested} ${nested === 1 ? "field" : "fields"} inside it. Questions, rules and rating that use these paths will fail their checks.`
            : "Questions, rules and rating that use this path will fail their checks."
        }
        onConfirm={() => deleting && remove(deleting)}
      />
    </Card>
  );
}

function SchemaRow({ node, flagged }: { node: SchemaNode; flagged: boolean }) {
  const meta = KIND_META[node.kind];
  const exposure = isContainer(node) ? node.exposure : undefined;

  return (
    <>
      <meta.icon
        aria-hidden
        className={cn(
          "size-4 shrink-0",
          node.kind === "repeatable" ? "text-primary" : "text-muted-foreground",
        )}
      />
      <span className="min-w-0 flex-1 truncate">{node.label || node.key}</span>
      {flagged ? (
        <span aria-label="Has problems" className="size-1.5 shrink-0 rounded-full bg-red-500" />
      ) : exposure ? (
        <span className="shrink-0 rounded-full bg-muted px-1.5 py-px text-xs text-muted-foreground ring-1 ring-border">
          {exposure}
        </span>
      ) : node.kind === "repeatable" ? (
        <span className="shrink-0 text-xs text-muted-foreground">List</span>
      ) : isContainer(node) ? null : (
        <span className="shrink-0 text-xs text-muted-foreground">{meta.label}</span>
      )}
    </>
  );
}
