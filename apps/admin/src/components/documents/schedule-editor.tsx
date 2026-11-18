import {
  contextSchema,
  type Jurisdiction,
  type ScheduleEntry,
  TRANSACTION_TYPES,
  type TransactionType,
} from "@pas/documents";
import { Button } from "@pas/ui/components/button";
import { Checkbox } from "@pas/ui/components/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@pas/ui/components/dialog";
import { EmptyState } from "@pas/ui/components/empty-state";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { Notice } from "@pas/ui/components/notice";
import { Panel } from "@pas/ui/components/panel";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@pas/ui/components/select";
import { Spinner } from "@pas/ui/components/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pas/ui/components/table";
import { jurisdictionCode, jurisdictionName } from "@pas/ui/lib/jurisdictions";
import { cn } from "@pas/ui/lib/utils";
import { ExternalLink, FileStack, Plus } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { ExpressionInput } from "@/components/builders/expression-input";
import {
  documentTitle,
  editionCode,
  type FormEdition,
  TEMPLATE_KIND_LABELS,
  TRANSACTION_LABELS,
  uniqueKey,
} from "@/components/catalog/documents";
import type { Contents } from "@/components/catalog/version-editor";
import { PdfPreview } from "@pas/ui/components/pdf-preview";
import { renderPacketPdf, usePreviewContext } from "./preview";

const appliesTo = (entry: ScheduleEntry) =>
  TRANSACTION_TYPES.filter((t) => entry.attachTo.includes(t))
    .map((t) => TRANSACTION_LABELS[t])
    .join(", ");

function DocumentCell({
  entry,
  contents,
  editions,
}: {
  entry: ScheduleEntry;
  contents: Contents;
  editions: readonly FormEdition[];
}) {
  const document = entry.document;
  const title = documentTitle(document, contents.documents.templates, editions);

  const meta =
    document.kind === "template"
      ? (() => {
          const template = contents.documents.templates.find((t) => t.key === document.key);

          return template ? `${TEMPLATE_KIND_LABELS[template.kind]} template` : "Missing template";
        })()
      : (() => {
          const edition = editions.find((e) => e.id === document.editionId);

          return edition ? editionCode(edition) : "Not in the forms library";
        })();

  return (
    <div className="grid gap-0.5">
      <span className="font-medium">{title}</span>
      <span className="text-xs text-muted-foreground tabular-nums">{meta}</span>
    </div>
  );
}

export function ScheduleEditor({
  contents,
  onChange,
  readOnly,
  editions,
  productName,
  version,
}: {
  contents: Contents;
  onChange: (schedule: ScheduleEntry[]) => void;
  readOnly: boolean;
  editions: readonly FormEdition[];
  productName: string;
  version: string;
}) {
  const schedule = contents.documents.schedule;
  const [editing, setEditing] = useState<ScheduleEntry | "new" | null>(null);

  const sorted = useMemo(
    () =>
      schedule
        .map((entry, position) => ({ entry, position }))
        .toSorted((a, b) => a.entry.order - b.entry.order || a.position - b.position)
        .map(({ entry }) => entry),
    [schedule],
  );

  const addAction = !readOnly && (
    <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
      <Plus /> Add document
    </Button>
  );

  return (
    <>
      <Panel
        title="Schedule"
        description="Which documents go in each packet, and in what order."
        action={schedule.length > 0 && addAction}
        flush
      >
        {schedule.length === 0 ? (
          <EmptyState
            icon={<FileStack />}
            title="Nothing scheduled yet"
            description="Schedule a declarations template for new business to publish this version."
            action={addAction}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Order</TableHead>
                <TableHead>Document</TableHead>
                <TableHead>Applies to</TableHead>
                <TableHead>Include when</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((entry) => (
                <TableRow
                  key={entry.id}
                  className={cn(!readOnly && "cursor-pointer hover:bg-muted/40")}
                  onClick={() => !readOnly && setEditing(entry)}
                >
                  <TableCell className="text-muted-foreground tabular-nums">
                    {entry.order}
                  </TableCell>
                  <TableCell>
                    <DocumentCell entry={entry} contents={contents} editions={editions} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{appliesTo(entry) || "–"}</TableCell>
                  <TableCell>
                    {entry.includeWhen ? (
                      <code className="rounded-md bg-muted/60 px-1.5 py-0.5 font-mono text-[0.8125rem]">
                        {entry.includeWhen}
                      </code>
                    ) : (
                      <span className="text-muted-foreground">Always</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>

      <PacketPreview
        contents={contents}
        editions={editions}
        productName={productName}
        version={version}
      />

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-xl">
          {editing !== null && (
            <EntryForm
              entry={editing === "new" ? undefined : editing}
              contents={contents}
              editions={editions}
              onSave={(entry) => {
                const exists = schedule.some((e) => e.id === entry.id);

                onChange(
                  exists
                    ? schedule.map((e) => (e.id === entry.id ? entry : e))
                    : [...schedule, entry],
                );

                setEditing(null);
              }}
              onRemove={(id) => {
                onChange(schedule.filter((e) => e.id !== id));
                setEditing(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function EntryForm({
  entry,
  contents,
  editions,
  onSave,
  onRemove,
}: {
  entry: ScheduleEntry | undefined;
  contents: Contents;
  editions: readonly FormEdition[];
  onSave: (entry: ScheduleEntry) => void;
  onRemove: (id: string) => void;
}) {
  const id = useId();
  const schedule = contents.documents.schedule;
  const templates = contents.documents.templates;

  const initialDocument = entry
    ? entry.document.kind === "template"
      ? `template:${entry.document.key}`
      : `form:${entry.document.editionId}`
    : "";

  const [document, setDocument] = useState(initialDocument);
  const [attachTo, setAttachTo] = useState<TransactionType[]>(entry?.attachTo ?? ["new_business"]);
  const [includeWhen, setIncludeWhen] = useState(entry?.includeWhen ?? "");
  const nextOrder = Math.max(0, ...schedule.map((e) => e.order)) + 10;
  const [order, setOrder] = useState(String(entry?.order ?? nextOrder));
  const [submitted, setSubmitted] = useState(false);

  const schema = useMemo(
    () => contextSchema(contents.riskSchema, "schedule"),
    [contents.riskSchema],
  );

  const invalid = !document || attachTo.length === 0 || !/^\d{1,4}$/.test(order);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitted(true);

    if (invalid) return;

    const [kind, ref] = [
      document.slice(0, document.indexOf(":")),
      document.slice(document.indexOf(":") + 1),
    ];

    const base =
      kind === "template" ? ref : (editions.find((e) => e.id === ref)?.formNumber ?? "form");

    onSave({
      id:
        entry?.id ??
        uniqueKey(
          schedule.map((e) => e.id),
          base.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
        ),
      document:
        kind === "template" ? { kind: "template", key: ref } : { kind: "form", editionId: ref },
      attachTo: TRANSACTION_TYPES.filter((t) => attachTo.includes(t)),
      ...(includeWhen.trim() && { includeWhen: includeWhen.trim() }),
      order: Number(order),
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-6">
      <DialogHeader>
        <DialogTitle>{entry ? "Edit scheduled document" : "Schedule a document"}</DialogTitle>
        <DialogDescription>
          Pick a template or a form edition from the forms library.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-4">
          <div className="grid gap-2">
            <Label htmlFor={`${id}-document`}>Document</Label>
            <Select value={document || undefined} onValueChange={setDocument}>
              <SelectTrigger id={`${id}-document`} aria-invalid={submitted && !document}>
                <SelectValue placeholder="Choose a document" />
              </SelectTrigger>
              <SelectContent>
                {templates.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>Templates</SelectLabel>
                    {templates.map((t) => (
                      <SelectItem key={t.key} value={`template:${t.key}`}>
                        {t.title}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {editions.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>Forms library</SelectLabel>
                    {editions.map((e) => (
                      <SelectItem key={e.id} value={`form:${e.id}`}>
                        <span className="tabular-nums">{editionCode(e)}</span>
                        <span className="text-muted-foreground">{e.title}</span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-order`}>Order</Label>
            <Input
              id={`${id}-order`}
              inputMode="numeric"
              className="tabular-nums"
              value={order}
              aria-invalid={submitted && !/^\d{1,4}$/.test(order)}
              onChange={(event) => setOrder(event.target.value)}
            />
          </div>
        </div>
        <fieldset className="m-0 grid gap-2 border-0 p-0">
          <legend className="mb-2 text-sm leading-none font-medium">Applies to</legend>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3">
            {TRANSACTION_TYPES.map((t) => (
              <label key={t} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={attachTo.includes(t)}
                  onCheckedChange={(checked) =>
                    setAttachTo(
                      checked === true ? [...attachTo, t] : attachTo.filter((x) => x !== t),
                    )
                  }
                />
                {TRANSACTION_LABELS[t]}
              </label>
            ))}
          </div>
          {submitted && attachTo.length === 0 && (
            <p className="m-0 text-sm text-destructive">Choose at least one transaction.</p>
          )}
        </fieldset>
        <div className="grid gap-2">
          <div className="flex items-baseline justify-between">
            <Label htmlFor={`${id}-when`}>Include when</Label>
            <span className="text-xs leading-none text-muted-foreground">Optional</span>
          </div>
          <ExpressionInput
            id={`${id}-when`}
            value={includeWhen}
            onChange={setIncludeWhen}
            schema={schema}
            placeholder={'jurisdiction == "US-IL"'}
            hint="Reads jurisdiction, coverages, transaction and risk."
          />
        </div>
      </div>
      <DialogFooter className="sm:justify-between">
        {entry ? (
          <Button
            type="button"
            variant="ghost"
            className="text-destructive"
            onClick={() => onRemove(entry.id)}
          >
            Remove
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button type="submit">{entry ? "Save" : "Add to schedule"}</Button>
        </div>
      </DialogFooter>
    </form>
  );
}

function PacketPreview({
  contents,
  editions,
  productName,
  version,
}: {
  contents: Contents;
  editions: readonly FormEdition[];
  productName: string;
  version: string;
}) {
  const id = useId();
  const jurisdictions = contents.availability.map((w) => w.jurisdiction);

  const [jurisdiction, setJurisdiction] = useState<Jurisdiction>(
    jurisdictions[0] ?? { country: "US" },
  );

  const [transaction, setTransaction] = useState<TransactionType>("new_business");
  const [coverages, setCoverages] = useState<string[]>(() => contents.coverages.map((c) => c.code));
  const [open, setOpen] = useState(false);

  const [pdf, setPdf] = useState<{ data: Uint8Array | null; error: string | null; busy: boolean }>({
    data: null,
    error: null,
    busy: false,
  });

  const scenario = useMemo(
    () => ({ jurisdiction, transaction, coverages }),
    [jurisdiction, transaction, coverages],
  );

  const preview = usePreviewContext(contents, productName, version, scenario);
  const entries = preview?.packet.entries ?? [];

  const openPacket = async () => {
    if (!preview) return;

    setOpen(true);
    setPdf({ data: null, error: null, busy: true });

    try {
      setPdf({
        data: await renderPacketPdf(preview.packet, preview.context, contents),
        error: null,
        busy: false,
      });
    } catch (error) {
      setPdf({ data: null, error: (error as Error).message, busy: false });
    }
  };

  const openInTab = () => {
    if (!pdf.data) return;

    const url = URL.createObjectURL(
      new Blob([pdf.data as Uint8Array<ArrayBuffer>], { type: "application/pdf" }),
    );

    window.open(url, "_blank", "noopener");
  };

  const pagesOf = (entry: ScheduleEntry) =>
    entry.document.kind === "form"
      ? editions.find((e) => e.id === (entry.document as { editionId: string }).editionId)
          ?.pageCount
      : undefined;

  const label = `${jurisdictionName(jurisdiction)} · ${TRANSACTION_LABELS[transaction]}`;

  return (
    <Panel
      title="Packet preview"
      description="The documents a transaction would get, with sample data."
      flush
      footer={
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm text-muted-foreground tabular-nums">
            {entries.length === 1 ? "1 document" : `${entries.length} documents`}
          </span>
          <Button size="sm" onClick={openPacket} disabled={entries.length === 0 || !preview}>
            Preview packet
          </Button>
        </div>
      }
    >
      <div className="grid gap-4 border-b p-(--card-p) sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor={`${id}-jurisdiction`}>Jurisdiction</Label>
          <Select
            value={jurisdictionCode(jurisdiction)}
            onValueChange={(code) =>
              setJurisdiction(jurisdictions.find((j) => jurisdictionCode(j) === code)!)
            }
          >
            <SelectTrigger id={`${id}-jurisdiction`}>
              <SelectValue placeholder="No jurisdictions yet" />
            </SelectTrigger>
            <SelectContent>
              {jurisdictions.map((j) => (
                <SelectItem key={jurisdictionCode(j)} value={jurisdictionCode(j)}>
                  {jurisdictionName(j)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${id}-transaction`}>Transaction</Label>
          <Select value={transaction} onValueChange={(t) => setTransaction(t as TransactionType)}>
            <SelectTrigger id={`${id}-transaction`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TRANSACTION_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {TRANSACTION_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {contents.coverages.length > 0 && (
          <fieldset className="m-0 grid gap-2 border-0 p-0 sm:col-span-2">
            <legend className="mb-2 text-sm leading-none font-medium">Coverages</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {contents.coverages.map((coverage) => (
                <label key={coverage.code} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={coverages.includes(coverage.code)}
                    onCheckedChange={(checked) =>
                      setCoverages(
                        checked === true
                          ? [...coverages, coverage.code]
                          : coverages.filter((code) => code !== coverage.code),
                      )
                    }
                  />
                  {coverage.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}
      </div>
      {preview?.packet.errors.map((error) => (
        <Notice
          key={error.entry}
          tone="error"
          className="mx-(--card-p) mt-4"
          title="A condition didn't evaluate"
        >
          {error.entry}: {error.message}
        </Notice>
      ))}
      {entries.length === 0 ? (
        <p className="m-0 px-(--card-p) py-8 text-center text-sm text-muted-foreground">
          No documents apply to this transaction.
        </p>
      ) : (
        <ol className="m-0 grid list-none divide-y p-0">
          {entries.map((entry, i) => (
            <li key={entry.id} className="flex items-center gap-4 px-(--card-p) py-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular-nums">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <DocumentCell entry={entry} contents={contents} editions={editions} />
              </div>
              {pagesOf(entry) !== undefined && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {pagesOf(entry)} {pagesOf(entry) === 1 ? "page" : "pages"}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[calc(100dvh-4rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-3xl">
          <DialogHeader className="flex flex-row items-center justify-between gap-4 border-b px-6 py-4 pr-14">
            <div className="grid gap-1">
              <DialogTitle>Packet preview</DialogTitle>
              <DialogDescription>{label}</DialogDescription>
            </div>
            <Button size="sm" variant="outline" onClick={openInTab} disabled={!pdf.data}>
              <ExternalLink /> Open PDF
            </Button>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto bg-muted/40 p-6">
            {pdf.error ? (
              <Notice tone="error" title="Couldn't build the packet">
                {pdf.error}
              </Notice>
            ) : pdf.busy ? (
              <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
                <Spinner /> Building the packet…
              </div>
            ) : (
              <PdfPreview data={pdf.data} label="Packet" />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
