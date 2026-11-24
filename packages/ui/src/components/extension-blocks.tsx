import type { BlockTone, DisplayBlock } from "@pas/extension-points";
import { ArrowUpRight } from "lucide-react";
import { Notice } from "./notice";
import { StatusChip, type StatusTone } from "./status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table";

const CHIP_TONE: Record<BlockTone, StatusTone> = {
  neutral: "neutral",
  info: "accent",
  success: "success",
  warning: "warning",
  danger: "danger",
};

const NOTICE_TONE: Record<BlockTone, "info" | "warning" | "error"> = {
  neutral: "info",
  info: "info",
  success: "info",
  warning: "warning",
  danger: "error",
};

function Block({ block }: { block: DisplayBlock }) {
  switch (block.type) {
    case "fields":
      return (
        <div className="grid gap-2">
          {block.title && <h3 className="m-0 text-sm leading-5 font-medium">{block.title}</h3>}
          <dl className="m-0 grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-x-4 gap-y-2 text-sm">
            {block.items.map((item, i) => (
              <div key={i} className="contents">
                <dt className="text-muted-foreground">{item.label}</dt>
                <dd className="m-0 min-w-0 break-words tabular-nums">{item.value || "–"}</dd>
              </div>
            ))}
          </dl>
        </div>
      );

    case "table":
      return (
        <div className="grid gap-2">
          {block.title && <h3 className="m-0 text-sm leading-5 font-medium">{block.title}</h3>}
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  {block.columns.map((column, i) => (
                    <TableHead key={i}>{column}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {block.rows.map((row, r) => (
                  <TableRow key={r}>
                    {row.map((cell, c) => (
                      <TableCell key={c} className="tabular-nums">
                        {cell || "–"}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      );

    case "status":
      return (
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">{block.detail}</span>
          <StatusChip tone={CHIP_TONE[block.tone]}>{block.label}</StatusChip>
        </div>
      );

    case "alert":
      return (
        <Notice tone={NOTICE_TONE[block.tone]} title={block.title}>
          {block.body}
        </Notice>
      );

    case "link":
      return (
        <a
          href={block.href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {block.label} <ArrowUpRight aria-hidden className="size-3.5" />
        </a>
      );
  }
}

/** Renders what an extension returned, in the fixed block vocabulary (PLAN §15.1). */
export function ExtensionBlocks({ blocks }: { blocks: readonly DisplayBlock[] }) {
  if (blocks.length === 0) {
    return <p className="m-0 text-sm text-muted-foreground">Nothing to show.</p>;
  }

  return (
    <div className="grid gap-4">
      {blocks.map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </div>
  );
}
