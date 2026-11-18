import type { WorkbookReport as Report } from "@pas/rating-engine/plan";
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
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { Notice } from "@pas/ui/components/notice";
import { Spinner } from "@pas/ui/components/spinner";
import { StatusChip } from "@pas/ui/components/status-chip";
import { cn } from "@pas/ui/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet, Upload, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useTRPC } from "@/lib/trpc";
import type { RaterWorkbook } from "./use-rating";

const MAX_BYTES = 10 * 1024 * 1024;

export const formatSize = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function WorkbookReport({ report }: { report: Report }) {
  const stats = [
    { label: "Sheets", value: report.sheets.length, detail: report.sheets.join(", ") },
    {
      label: "Named ranges",
      value: report.names.length,
      detail: report.names.join(", ") || "None",
    },
    {
      label: "Formulas",
      value: report.formulaCount,
      detail: `${report.functions.length} functions`,
    },
  ];

  return (
    <div className="grid gap-5">
      <dl className="m-0 grid gap-3 sm:grid-cols-3">
        {stats.map((stat) => (
          <div key={stat.label} className="grid gap-0.5 rounded-lg border px-3.5 py-3">
            <dt className="text-xs text-muted-foreground">{stat.label}</dt>
            <dd className="m-0 text-lg leading-7 font-semibold tabular-nums">{stat.value}</dd>
            <dd className="m-0 truncate text-xs text-muted-foreground" title={stat.detail}>
              {stat.detail}
            </dd>
          </div>
        ))}
      </dl>
      {report.functions.length > 0 && (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="h-9 bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-3.5 font-medium">Function</th>
                <th className="px-3 text-right font-medium">Uses</th>
                <th className="px-3.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {report.functions.map((fn) => (
                <tr key={fn.name} className="border-t align-top">
                  <td className="px-3.5 py-2.5">
                    <code className="font-mono text-[0.8125rem]">{fn.name}</code>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fn.count}</td>
                  <td className="px-3.5 py-2">
                    {fn.supported ? (
                      <StatusChip tone="success">Supported</StatusChip>
                    ) : (
                      <span className="grid justify-items-start gap-1">
                        <StatusChip tone="danger">Blocked</StatusChip>
                        <span className="text-xs text-muted-foreground">{fn.reason}</span>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {report.problems.filter((p) => p.code !== "unsupported_function").length > 0 && (
        <ul className="m-0 grid list-none gap-1.5 p-0 text-sm">
          {report.problems
            .filter((p) => p.code !== "unsupported_function")
            .map((problem, i) => (
              <li key={i} className="flex items-start gap-2">
                <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-red-500" />
                {problem.message}
              </li>
            ))}
        </ul>
      )}
      {report.notices.length > 0 && (
        <ul className="m-0 grid list-none gap-1.5 p-0 text-sm text-amber-900">
          {report.notices.map((notice, i) => (
            <li key={i} className="flex items-start gap-2">
              <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500" />
              {notice.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function UploadWorkbookDialog({
  open,
  onOpenChange,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded: (workbook: RaterWorkbook) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        {open && (
          <UploadForm
            onUploaded={(workbook) => {
              onUploaded(workbook);
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function UploadForm({ onUploaded }: { onUploaded: (workbook: RaterWorkbook) => void }) {
  const id = useId();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [failure, setFailure] = useState<{ message: string; report?: Report }>();

  const fileError = !file
    ? "Choose an .xlsx workbook"
    : !/\.xlsx$/i.test(file.name)
      ? "Choose an .xlsx file"
      : file.size > MAX_BYTES
        ? "Choose a workbook smaller than 10 MB"
        : null;

  const choose = (next: File | undefined) => {
    if (!next) return;

    setFile(next);
    setFailure(undefined);

    if (!name) setName(next.name.replace(/\.xlsx$/i, "").replace(/[_-]+/g, " "));
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    if (fileError || !file) return setFailure({ message: fileError ?? "Choose a workbook" });

    const body = new FormData();
    body.set("name", name);
    body.set("file", file);
    setBusy(true);
    setFailure(undefined);

    try {
      const response = await fetch("/api/uploads/rater-workbooks", {
        method: "POST",
        body,
        credentials: "same-origin",
      });

      const result = (await response.json()) as
        | RaterWorkbook
        | { message: string; details?: { report?: Report } | null };

      if (!response.ok && "message" in result) {
        setFailure({
          message: result.message,
          ...(result.details?.report && { report: result.details.report }),
        });

        return;
      }

      await queryClient.invalidateQueries({ queryKey: trpc.rating.workbooks.list.queryKey() });
      onUploaded(result as RaterWorkbook);
    } catch (cause) {
      setFailure({ message: (cause as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-6" noValidate>
      <DialogHeader>
        <DialogTitle>Upload rater workbook</DialogTitle>
        <DialogDescription>
          Stored as uploaded and checked for functions the engine can't run.
        </DialogDescription>
      </DialogHeader>
      {failure && (
        <Notice tone="error" title={failure.message}>
          {failure.report ? "Replace the blocked functions below, then upload it again." : null}
        </Notice>
      )}
      {failure?.report && <WorkbookReport report={failure.report} />}
      <input
        ref={input}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => choose(event.target.files?.[0])}
      />
      {file ? (
        <div className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <FileSpreadsheet className="size-4" />
          </span>
          <span className="grid min-w-0 flex-1">
            <span className="truncate text-sm font-medium">{file.name}</span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatSize(file.size)}
            </span>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground"
            aria-label="Remove file"
            onClick={() => {
              setFile(null);
              setFailure(undefined);

              if (input.current) input.current.value = "";
            }}
          >
            <X />
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            choose(event.dataTransfer.files[0]);
          }}
          className={cn(
            "flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-7 text-center outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
            dragging ? "border-primary bg-primary/5" : "hover:bg-muted/40",
          )}
        >
          <Upload className="size-5 text-muted-foreground" />
          <span className="text-sm font-medium">Choose an .xlsx workbook or drop it here</span>
          <span className="text-xs text-muted-foreground">Up to 10 MB, without macros</span>
        </button>
      )}
      <div className="grid gap-2">
        <Label htmlFor={`${id}-name`}>Name</Label>
        <Input
          id={`${id}-name`}
          value={name}
          placeholder="Homeowners rater"
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">Cancel</Button>
        </DialogClose>
        <Button type="submit" disabled={busy}>
          {busy && <Spinner />}
          Upload workbook
        </Button>
      </DialogFooter>
    </form>
  );
}
