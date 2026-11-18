import { ChevronRight } from "lucide-react";
import type * as React from "react";
import { useEffect, useId, useRef } from "react";
import { cn } from "../lib/utils";

export interface TreeRow {
  id: string;
  depth: number;
  label: string;
  /** Undefined for leaves. */
  expanded?: boolean;
  content: React.ReactNode;
}

interface TreeProps {
  label: string;
  rows: readonly TreeRow[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onToggle?: (id: string) => void;
  /** Alt+Arrow reorders the selected row among its siblings. */
  onMove?: (id: string, delta: -1 | 1) => void;
  className?: string;
}

/** A keyboard-navigable tree over pre-flattened rows (the caller decides what's expanded). */
function Tree({ label, rows, selectedId, onSelect, onToggle, onMove, className }: TreeProps) {
  const base = useId();
  const list = useRef<HTMLUListElement>(null);
  const position = rows.findIndex((row) => row.id === selectedId);
  const domId = (id: string) => `${base}-${id.replace(/[^A-Za-z0-9_-]/g, "_")}`;

  useEffect(() => {
    if (!selectedId) return;

    list.current
      ?.querySelector(`#${CSS.escape(domId(selectedId))}`)
      ?.scrollIntoView({ block: "nearest" });
  });

  const parentOf = (index: number) => {
    const depth = rows[index]!.depth;

    for (let i = index - 1; i >= 0; i--) if (rows[i]!.depth < depth) return rows[i];

    return undefined;
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const current = rows[position];

    const go = (index: number) => {
      const row = rows[Math.max(0, Math.min(rows.length - 1, index))];

      if (row) onSelect(row.id);
    };

    if (
      event.altKey &&
      current &&
      onMove &&
      (event.key === "ArrowUp" || event.key === "ArrowDown")
    ) {
      onMove(current.id, event.key === "ArrowUp" ? -1 : 1);
    } else if (event.key === "ArrowDown") go(position + 1);
    else if (event.key === "ArrowUp") go(position < 0 ? 0 : position - 1);
    else if (event.key === "Home") go(0);
    else if (event.key === "End") go(rows.length - 1);
    else if (event.key === "ArrowRight" && current) {
      if (current.expanded === false) onToggle?.(current.id);
      else if (current.expanded) go(position + 1);
    } else if (event.key === "ArrowLeft" && current) {
      if (current.expanded) onToggle?.(current.id);
      else {
        const parent = parentOf(position);

        if (parent) onSelect(parent.id);
      }
    } else return;

    event.preventDefault();
  };

  return (
    <ul
      ref={list}
      role="tree"
      aria-label={label}
      tabIndex={0}
      aria-activedescendant={selectedId ? domId(selectedId) : undefined}
      onKeyDown={onKeyDown}
      className={cn(
        "group/tree m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-px p-1.5 outline-none",
        className,
      )}
    >
      {rows.map((row) => {
        const selected = row.id === selectedId;

        return (
          <li
            key={row.id}
            id={domId(row.id)}
            role="treeitem"
            aria-level={row.depth + 1}
            aria-selected={selected}
            aria-expanded={row.expanded}
            aria-label={row.label}
            onClick={() => onSelect(row.id)}
            style={{ paddingLeft: `${row.depth * 16 + 4}px` }}
            className={cn(
              "flex h-8 min-w-0 cursor-default items-center gap-1 rounded-md pr-2 text-sm select-none",
              selected ? "bg-primary/[0.07] text-foreground" : "text-foreground hover:bg-muted/70",
              selected && "group-focus-visible/tree:ring-2 group-focus-visible/tree:ring-ring/50",
            )}
          >
            {row.expanded === undefined ? (
              <span aria-hidden className="size-5 shrink-0" />
            ) : (
              <span
                aria-hidden
                onClick={(event) => {
                  event.stopPropagation();
                  onToggle?.(row.id);
                }}
                className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <ChevronRight
                  className={cn("size-3.5 transition-transform", row.expanded && "rotate-90")}
                />
              </span>
            )}
            <div className="flex min-w-0 flex-1 items-center gap-2">{row.content}</div>
          </li>
        );
      })}
    </ul>
  );
}

export { Tree };
