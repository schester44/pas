import { Button } from "@pas/ui/components/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@pas/ui/components/command";
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
import { Popover, PopoverContent, PopoverTrigger } from "@pas/ui/components/popover";
import { Spinner } from "@pas/ui/components/spinner";
import { subdivisionsOf } from "@pas/ui/lib/jurisdictions";
import { cn } from "@pas/ui/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, FileText, Upload, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import type { FormEdition } from "@/components/catalog/documents";
import { useTRPC } from "@/lib/trpc";

const STATES = subdivisionsOf("US");
const MAX_BYTES = 20 * 1024 * 1024;
const short = (code: string) => code.split("-").at(-1);

interface Fields {
  formNumber: string;
  edition: string;
  title: string;
  carrier: string;
  jurisdictions: string[];
}

const EMPTY: Fields = { formNumber: "", edition: "", title: "", carrier: "", jurisdictions: [] };

const formatSize = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function UploadFormDialog({
  open,
  onOpenChange,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded: (edition: FormEdition) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open && <UploadForm onUploaded={onUploaded} />}
      </DialogContent>
    </Dialog>
  );
}

function UploadForm({ onUploaded }: { onUploaded: (edition: FormEdition) => void }) {
  const id = useId();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const fileError = !file
    ? "Choose a PDF"
    : file.type && file.type !== "application/pdf"
      ? "Choose a PDF file"
      : file.size > MAX_BYTES
        ? "Choose a PDF smaller than 20 MB"
        : null;

  const errors = {
    file: fileError,
    formNumber: fields.formNumber.trim() ? null : "Enter the form number",
    edition: /^\s*\d{2}[\s/-]?\d{2,4}\s*$/.test(fields.edition)
      ? null
      : "Enter month and year, like 05 11",
    title: fields.title.trim() ? null : "Enter the title",
  };

  const set = (patch: Partial<Fields>) => setFields((current) => ({ ...current, ...patch }));

  const choose = (next: File | undefined) => {
    if (!next) return;

    setFile(next);

    if (!fields.title) set({ title: next.name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ") });
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitted(true);

    if (Object.values(errors).some(Boolean) || !file) return;

    const body = new FormData();
    body.set("formNumber", fields.formNumber);
    body.set("edition", fields.edition);
    body.set("title", fields.title);
    body.set("carrier", fields.carrier);
    body.set("jurisdictions", fields.jurisdictions.join(","));
    body.set("file", file);
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/uploads/form-editions", {
        method: "POST",
        body,
        credentials: "same-origin",
      });

      const result = (await response.json()) as FormEdition | { message: string };

      if (!response.ok) throw new Error("message" in result ? result.message : "Upload failed");

      await queryClient.invalidateQueries({
        queryKey: trpc.documents.formEditions.list.queryKey(),
      });

      onUploaded(result as FormEdition);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const show = (key: keyof typeof errors) => submitted && errors[key];

  return (
    <form onSubmit={submit} className="grid gap-6" noValidate>
      <DialogHeader>
        <DialogTitle>Upload form</DialogTitle>
        <DialogDescription>
          Each edition is stored as filed and can't be changed later.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        <div className="grid gap-2">
          <input
            ref={input}
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            tabIndex={-1}
            onChange={(event) => choose(event.target.files?.[0])}
          />
          {file ? (
            <div className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <FileText className="size-4" />
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
                show("file") && "border-destructive",
              )}
            >
              <Upload className="size-5 text-muted-foreground" />
              <span className="text-sm font-medium">Choose a PDF or drop it here</span>
              <span className="text-xs text-muted-foreground">Up to 20 MB</span>
            </button>
          )}
          {show("file") && <p className="m-0 text-sm text-destructive">{errors.file}</p>}
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-4">
          <Field id={`${id}-number`} label="Form number" error={show("formNumber")}>
            <Input
              id={`${id}-number`}
              value={fields.formNumber}
              placeholder="HO 00 03"
              aria-invalid={!!show("formNumber")}
              onChange={(event) => set({ formNumber: event.target.value })}
            />
          </Field>
          <Field id={`${id}-edition`} label="Edition" error={show("edition")}>
            <Input
              id={`${id}-edition`}
              value={fields.edition}
              placeholder="05 11"
              className="tabular-nums"
              aria-invalid={!!show("edition")}
              onChange={(event) => set({ edition: event.target.value })}
            />
          </Field>
        </div>
        <Field id={`${id}-title`} label="Title" error={show("title")}>
          <Input
            id={`${id}-title`}
            value={fields.title}
            placeholder="Homeowners 3 – special form"
            aria-invalid={!!show("title")}
            onChange={(event) => set({ title: event.target.value })}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={`${id}-states`} label="States" optional>
            <StatesPicker
              id={`${id}-states`}
              value={fields.jurisdictions}
              onChange={(jurisdictions) => set({ jurisdictions })}
            />
          </Field>
          <Field id={`${id}-carrier`} label="Carrier" optional>
            <Input
              id={`${id}-carrier`}
              value={fields.carrier}
              onChange={(event) => set({ carrier: event.target.value })}
            />
          </Field>
        </div>
      </div>
      {error && (
        <Notice tone="error" title="Couldn't upload this form">
          {error}
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
          Upload form
        </Button>
      </DialogFooter>
    </form>
  );
}

function Field({
  id,
  label,
  optional,
  error,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  error?: string | false | null;
  children: React.ReactNode;
}) {
  return (
    <div className="grid content-start gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        {optional && <span className="text-xs leading-none text-muted-foreground">Optional</span>}
      </div>
      {children}
      {error && <p className="m-0 text-sm text-destructive">{error}</p>}
    </div>
  );
}

function StatesPicker({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = new Set(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-full justify-between px-3 font-normal",
            value.length === 0 && "text-muted-foreground",
          )}
        >
          <span className="truncate">
            {value.length === 0 ? "All states" : value.map(short).join(", ")}
          </span>
          <ChevronsUpDown className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput placeholder="Search states" className="h-10" />
          <CommandList className="max-h-64 p-1">
            <CommandEmpty>No states match.</CommandEmpty>
            <CommandGroup>
              {STATES.map(([code, name]) => (
                <CommandItem
                  key={code}
                  value={`${name} ${short(code)}`}
                  onSelect={() =>
                    onChange(
                      selected.has(code)
                        ? value.filter((c) => c !== code)
                        : [...value, code].toSorted(),
                    )
                  }
                >
                  <span className="truncate">{name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{short(code)}</span>
                  <Check
                    className={cn("size-4", selected.has(code) ? "text-primary!" : "invisible")}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
