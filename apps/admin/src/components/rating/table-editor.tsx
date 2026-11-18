import {
  type Band,
  type DimensionMatch,
  type RateTable,
  rateTableFromCsv,
  type RowKey,
} from "@pas/rating-engine/plan";
import { Button } from "@pas/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@pas/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@pas/ui/components/dropdown-menu";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { Notice } from "@pas/ui/components/notice";
import { Panel } from "@pas/ui/components/panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pas/ui/components/select";
import { Textarea } from "@pas/ui/components/textarea";
import { cn } from "@pas/ui/lib/utils";
import { Ellipsis, Plus, X } from "lucide-react";
import { useId, useState } from "react";
import type { RatingIssue } from "./use-rating";

const MATCHES: Record<DimensionMatch, string> = {
  exact: "Exact",
  band: "Band",
  interpolate: "Interpolate",
};

const NUMBER = /^-?\d+(\.\d+)?$/;
const BAND = /^\s*(-?\d+(?:\.\d+)?)?\s*\.\.\s*(-?\d+(?:\.\d+)?)?\s*$/;

const isBand = (key: RowKey): key is Band => typeof key === "object";

export function keyText(key: RowKey | undefined): string {
  if (key === undefined) return "";

  if (isBand(key)) return `${key.from ?? ""}..${key.to ?? ""}`;

  return String(key);
}

function parseKey(text: string, match: DimensionMatch): RowKey | null {
  const value = text.trim();

  if (match === "band") {
    const found = BAND.exec(value);

    if (!found) return null;

    return {
      ...(found[1] !== undefined && { from: Number(found[1]) }),
      ...(found[2] !== undefined && { to: Number(found[2]) }),
    };
  }

  if (match === "interpolate") return NUMBER.test(value) ? Number(value) : null;

  return NUMBER.test(value) ? Number(value) : value;
}

function CellInput({
  value,
  label,
  invalid,
  readOnly,
  align,
  onCommit,
}: {
  value: string;
  label: string;
  invalid?: boolean;
  readOnly?: boolean;
  align?: "right";
  onCommit: (text: string) => void;
}) {
  const [text, setText] = useState(value);
  const [synced, setSynced] = useState(value);

  if (synced !== value) {
    setSynced(value);
    setText(value);
  }

  return (
    <input
      aria-label={label}
      value={text}
      readOnly={readOnly}
      aria-invalid={invalid}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => text !== value && onCommit(text)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      className={cn(
        "h-9 w-full bg-transparent px-3 text-sm tabular-nums outline-none focus:bg-primary/5 focus:ring-2 focus:ring-primary/30 focus:ring-inset aria-invalid:bg-red-50 aria-invalid:text-red-900",
        align === "right" && "text-right",
      )}
    />
  );
}

export function TableEditor({
  table,
  issues,
  readOnly,
  onChange,
  onDelete,
}: {
  table: RateTable;
  issues: RatingIssue[];
  readOnly: boolean;
  onChange: (table: RateTable) => void;
  onDelete: () => void;
}) {
  const [importing, setImporting] = useState(false);
  const dims = table.dimensions;

  const setRows = (rows: RateTable["rows"]) => onChange({ ...table, rows });

  const setDimension = (i: number, patch: Partial<RateTable["dimensions"][number]>) =>
    onChange({ ...table, dimensions: dims.map((d, j) => (j === i ? { ...d, ...patch } : d)) });

  const removeDimension = (i: number) =>
    onChange({
      ...table,
      dimensions: dims.filter((_, j) => j !== i),
      rows: table.rows.map((row) => ({ ...row, keys: row.keys.filter((_, j) => j !== i) })),
    });

  const addDimension = () =>
    onChange({
      ...table,
      dimensions: [...dims, { name: `key_${dims.length + 1}`, match: "exact" }],
      rows: table.rows.map((row) => ({ ...row, keys: [...row.keys, ""] })),
    });

  function paste(event: React.ClipboardEvent) {
    const text = event.clipboardData.getData("text/plain");

    if (readOnly || !text.includes("\n")) return;

    const lines = text
      .trim()
      .split(/\r?\n/)
      .map((line) => line.split(/\t|,/));

    if (lines.some((cells) => cells.length !== dims.length + 1)) return;

    event.preventDefault();

    const rows = lines.flatMap((cells) => {
      const keys = dims.map((d, i) => parseKey(cells[i] ?? "", d.match));
      const value = cells[dims.length]!.trim();

      return keys.every((k) => k !== null) && NUMBER.test(value)
        ? [{ keys: keys as RowKey[], value }]
        : [];
    });

    setRows([...table.rows, ...rows]);
  }

  return (
    <Panel
      flush
      title={<code className="font-mono text-[0.9375rem]">{table.key}</code>}
      description={
        <span className="tabular-nums">
          {table.rows.length} {table.rows.length === 1 ? "row" : "rows"} ·{" "}
          {dims.map((d) => d.name).join(" × ") || "No dimensions"}
        </span>
      }
      action={
        !readOnly && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setImporting(true)}>
              Import CSV
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="size-8" aria-label="Table actions">
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onDelete} className="text-destructive">
                  Delete table
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )
      }
    >
      {issues.length > 0 && (
        <ul className="m-0 grid list-none divide-y border-b p-0">
          {issues.map((issue, i) => (
            <li key={i} className="flex items-center gap-2 px-(--card-p) py-2.5 text-sm">
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-red-500" />
              {issue.message}
            </li>
          ))}
        </ul>
      )}
      <div onPaste={paste} className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              {dims.map((dimension, i) => (
                <th key={i} className="border-r p-0 font-medium">
                  <div className="flex items-center gap-1 pr-1">
                    <CellInput
                      value={dimension.name}
                      label={`Dimension ${i + 1} name`}
                      readOnly={readOnly}
                      onCommit={(name) => setDimension(i, { name: name.trim() || dimension.name })}
                    />
                    <Select
                      value={dimension.match}
                      disabled={readOnly}
                      onValueChange={(match) => setDimension(i, { match: match as DimensionMatch })}
                    >
                      <SelectTrigger
                        size="sm"
                        aria-label={`${dimension.name} match`}
                        className="h-7 w-28 shrink-0 border-transparent bg-transparent text-xs shadow-none"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(MATCHES).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!readOnly && (
                      <button
                        type="button"
                        aria-label={`Remove ${dimension.name}`}
                        onClick={() => removeDimension(i)}
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <X className="size-3.5" />
                      </button>
                    )}
                  </div>
                </th>
              ))}
              <th className="w-40 px-3 text-right font-medium">Rate</th>
              {!readOnly && <th className="w-10" aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, r) => (
              <tr key={r} className="group border-b last:border-b-0">
                {dims.map((dimension, i) => (
                  <td key={i} className="border-r p-0">
                    <CellInput
                      value={keyText(row.keys[i])}
                      label={`Row ${r + 1}, ${dimension.name}`}
                      readOnly={readOnly}
                      invalid={keyText(row.keys[i]) === ""}
                      onCommit={(text) => {
                        const key = parseKey(text, dimension.match);

                        if (key === null) return;

                        const keys = [...row.keys];
                        keys[i] = key;
                        setRows(table.rows.map((other, j) => (j === r ? { ...row, keys } : other)));
                      }}
                    />
                  </td>
                ))}
                <td className="p-0">
                  <CellInput
                    value={String(row.value)}
                    label={`Row ${r + 1}, rate`}
                    readOnly={readOnly}
                    align="right"
                    invalid={!NUMBER.test(String(row.value))}
                    onCommit={(value) =>
                      setRows(
                        table.rows.map((other, j) =>
                          j === r ? { ...row, value: value.trim() } : other,
                        ),
                      )
                    }
                  />
                </td>
                {!readOnly && (
                  <td className="p-0 text-center">
                    <button
                      type="button"
                      aria-label={`Remove row ${r + 1}`}
                      onClick={() => setRows(table.rows.filter((_, j) => j !== r))}
                      className="rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100"
                    >
                      <X className="size-3.5" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t bg-muted/40 px-(--card-p) py-3">
        {!readOnly && (
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setRows([...table.rows, { keys: dims.map(() => ""), value: "1" }])}
            >
              <Plus /> Add row
            </Button>
            <Button size="sm" variant="ghost" onClick={addDimension}>
              <Plus /> Add dimension
            </Button>
          </div>
        )}
        <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          Rate when no row matches
          <Input
            className="h-8 w-28 text-right tabular-nums"
            placeholder="None"
            readOnly={readOnly}
            value={table.default === undefined ? "" : String(table.default)}
            onChange={(event) => {
              const { default: _, ...rest } = table;
              const value = event.target.value.trim();

              onChange(value ? { ...rest, default: value } : rest);
            }}
          />
        </label>
      </div>
      <ImportCsvDialog
        open={importing}
        onOpenChange={setImporting}
        table={table}
        onImport={(next) => onChange(next)}
      />
    </Panel>
  );
}

function ImportCsvDialog({
  open,
  onOpenChange,
  table,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  table: RateTable;
  onImport: (table: RateTable) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        {open && (
          <ImportCsvForm
            table={table}
            onImport={(next) => {
              onImport(next);
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ImportCsvForm({
  table,
  onImport,
}: {
  table: RateTable;
  onImport: (table: RateTable) => void;
}) {
  const id = useId();
  const header = [...table.dimensions.map((d) => d.name), "value"].join(",");
  const [text, setText] = useState(`${header}\n`);
  const [error, setError] = useState<string>();

  async function choose(file: File | undefined) {
    if (file) setText(await file.text());
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();

    try {
      const parsed = rateTableFromCsv(text, { key: table.key, dimensions: table.dimensions });
      onImport(parsed);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-6">
      <DialogHeader>
        <DialogTitle>Import CSV</DialogTitle>
        <DialogDescription>
          Replaces every row. Bands are written <code className="font-mono">from..to</code>; a row
          of <code className="font-mono">*</code> sets the default.
        </DialogDescription>
      </DialogHeader>
      {error && (
        <Notice tone="error" title="Couldn't import">
          {error}
        </Notice>
      )}
      <div className="grid gap-2">
        <div className="flex items-baseline justify-between">
          <Label htmlFor={id}>Rows</Label>
          <label className="cursor-pointer text-sm font-medium text-primary hover:underline">
            Choose file
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(event) => void choose(event.target.files?.[0])}
            />
          </label>
        </div>
        <Textarea
          id={id}
          value={text}
          spellCheck={false}
          onChange={(event) => setText(event.target.value)}
          className="min-h-56 font-mono text-[0.8125rem] leading-5"
        />
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">Cancel</Button>
        </DialogClose>
        <Button type="submit">Replace rows</Button>
      </DialogFooter>
    </form>
  );
}
