import { Button } from "@pas/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@pas/ui/components/dialog";
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
import { Spinner } from "@pas/ui/components/spinner";
import { Textarea } from "@pas/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { FileText, Plus } from "lucide-react";
import type * as React from "react";
import { useState } from "react";
import { formatDate, formatPlainDate } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";
import {
  downloadBase64,
  INSPECTION_TYPES,
  InspectionStatus,
  OWNERS,
  type Subjectivity,
  SubjectivityStatus,
  TIMINGS,
} from "./labels";

function dueText(s: Subjectivity) {
  if (s.dueDate) return `Due ${formatPlainDate(s.dueDate)}`;

  if (s.timing === "pre_bind") return "Due before binding";

  return s.dueDays !== null ? `Due ${s.dueDays} days after binding` : "After binding";
}

/** The quote's or policy's subjectivities, with what's been received and the underwriter's calls. */
export function SubjectivitiesPanel({
  quoteId,
  policyId,
  submissionId,
  canDecide,
}: {
  quoteId?: string;
  policyId?: string;
  submissionId: string;
  canDecide: boolean;
}) {
  const trpc = useTRPC();
  const [adding, setAdding] = useState(false);
  const [prompt, setPrompt] = useState<{ id: string; kind: "waive" | "reopen" } | null>(null);
  const queryClient = useQueryClient();

  const list = useQuery(
    policyId
      ? trpc.underwriting.subjectivities.forPolicy.queryOptions({ policyId })
      : trpc.underwriting.subjectivities.forQuote.queryOptions({ quoteId: quoteId! }),
  );

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: trpc.underwriting.subjectivities.pathKey() });

  const accept = useMutation(
    trpc.underwriting.subjectivities.accept.mutationOptions({ onSuccess: refresh }),
  );

  const download = async (id: string, key: string) =>
    downloadBase64(
      await queryClient.fetchQuery(
        trpc.underwriting.subjectivities.document.queryOptions({ id, key }),
      ),
    );

  const rows = list.data ?? [];

  return (
    <Panel
      title="Subjectivities"
      flush
      action={
        canDecide && (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <Plus /> Add
          </Button>
        )
      }
    >
      {rows.length === 0 ? (
        <p className="m-0 px-(--card-p) py-6 text-sm text-muted-foreground">
          {list.isPending ? "Loading…" : "No subjectivities on this quote."}
        </p>
      ) : (
        <ul className="m-0 list-none divide-y p-0">
          {rows.map((s) => (
            <li key={s.id} className="grid gap-2 px-(--card-p) py-3">
              <div className="flex items-start gap-3">
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <span className="text-sm leading-5 font-medium">{s.title}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {[
                      dueText(s),
                      OWNERS[s.owner] ?? s.owner,
                      s.source === "underwriter"
                        ? "Added by underwriting"
                        : s.source === "inspection"
                          ? "From an inspection"
                          : "From the rules",
                    ].join(" · ")}
                  </span>
                  {s.overdue && s.consequence && (
                    <span className="text-xs text-red-700">{s.consequence}</span>
                  )}
                </div>
                <SubjectivityStatus status={s.status} overdue={s.overdue} />
              </div>
              {s.documents.length > 0 && (
                <ul className="m-0 grid list-none gap-1 p-0">
                  {s.documents.map((d) => (
                    <li key={d.key}>
                      <button
                        type="button"
                        onClick={() => void download(s.id, d.key)}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                      >
                        <FileText className="size-3.5" /> {d.name}
                      </button>
                      <span className="text-xs text-muted-foreground">
                        {" "}
                        · {d.uploadedBy}, {formatDate(d.uploadedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {canDecide && (s.status === "open" || s.status === "received") && (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={accept.isPending}
                    onClick={() => accept.mutate({ id: s.id })}
                  >
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setPrompt({ id: s.id, kind: "waive" })}
                  >
                    Waive
                  </Button>
                  {s.status === "received" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setPrompt({ id: s.id, kind: "reopen" })}
                    >
                      Ask for more
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <AddSubjectivityDialog
        open={adding}
        submissionId={submissionId}
        onClose={() => setAdding(false)}
        onAdded={refresh}
      />
      <NoteDialog prompt={prompt} onClose={() => setPrompt(null)} onDone={refresh} />
    </Panel>
  );
}

function NoteDialog({
  prompt,
  onClose,
  onDone,
}: {
  prompt: { id: string; kind: "waive" | "reopen" } | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const [text, setText] = useState("");
  const waive = useMutation(trpc.underwriting.subjectivities.waive.mutationOptions());
  const reopen = useMutation(trpc.underwriting.subjectivities.reopen.mutationOptions());
  const pending = waive.isPending || reopen.isPending;
  const error = waive.error ?? reopen.error;
  const waiving = prompt?.kind === "waive";

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!prompt) return;

    const done = { onSuccess: () => (setText(""), onDone(), onClose()) };

    if (waiving) waive.mutate({ id: prompt.id, reason: text }, done);
    else reopen.mutate({ id: prompt.id, note: text }, done);
  }

  return (
    <Dialog open={prompt !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <form onSubmit={onSubmit} className="grid gap-6">
          <DialogHeader>
            <DialogTitle>{waiving ? "Waive the subjectivity" : "Ask for more"}</DialogTitle>
            <DialogDescription>
              {waiving
                ? "It no longer has to be met. The reason is kept on the record."
                : "It goes back to the producer as open."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="subjectivity-note">{waiving ? "Reason" : "What's still needed"}</Label>
            <Textarea
              id="subjectivity-note"
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
          {error && (
            <Notice tone="error" title="Couldn't save">
              {error.message}
            </Notice>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !text.trim()}>
              {pending && <Spinner />}
              {waiving ? "Waive" : "Send back"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export interface DraftSubjectivity {
  title: string;
  description?: string;
  timing: "pre_bind" | "post_bind";
  dueDays?: number;
  owner: "producer" | "insured" | "underwriter";
}

/** Title, timing, due days and owner of one subjectivity. */
export function SubjectivityFields({
  value,
  onChange,
  idPrefix,
}: {
  value: DraftSubjectivity;
  onChange: (next: DraftSubjectivity) => void;
  idPrefix: string;
}) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-title`}>Subjectivity</Label>
        <Input
          id={`${idPrefix}-title`}
          value={value.title}
          placeholder="Copy of the wind mitigation inspection report"
          onChange={(e) => onChange({ ...value, title: e.target.value })}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="grid gap-2">
          <Label>Due</Label>
          <Select
            value={value.timing}
            onValueChange={(timing) =>
              onChange({ ...value, timing: timing as DraftSubjectivity["timing"] })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(TIMINGS).map(([key, label]) => (
                <SelectItem key={key} value={key}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${idPrefix}-days`}>Days after binding</Label>
          <Input
            id={`${idPrefix}-days`}
            type="number"
            min={0}
            disabled={value.timing === "pre_bind"}
            className="tabular-nums"
            value={value.dueDays ?? ""}
            onChange={(e) =>
              onChange({
                ...value,
                ...(e.target.value === ""
                  ? { dueDays: undefined }
                  : { dueDays: Number(e.target.value) }),
              })
            }
          />
        </div>
        <div className="grid gap-2">
          <Label>Owner</Label>
          <Select
            value={value.owner}
            onValueChange={(owner) =>
              onChange({ ...value, owner: owner as DraftSubjectivity["owner"] })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(OWNERS).map(([key, label]) => (
                <SelectItem key={key} value={key}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

export const blankSubjectivity = (): DraftSubjectivity => ({
  title: "",
  timing: "post_bind",
  dueDays: 30,
  owner: "producer",
});

function AddSubjectivityDialog({
  open,
  submissionId,
  onClose,
  onAdded,
}: {
  open: boolean;
  submissionId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const trpc = useTRPC();
  const [draft, setDraft] = useState(blankSubjectivity);
  const add = useMutation(trpc.underwriting.subjectivities.add.mutationOptions());

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();

    add.mutate(
      { submissionId, ...draft, ...(draft.timing === "pre_bind" && { dueDays: undefined }) },
      { onSuccess: () => (setDraft(blankSubjectivity()), onAdded(), onClose()) },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <form onSubmit={onSubmit} className="grid gap-6">
          <DialogHeader>
            <DialogTitle>Add a subjectivity</DialogTitle>
            <DialogDescription>
              The producer sees it and can upload what it asks for.
            </DialogDescription>
          </DialogHeader>
          <SubjectivityFields value={draft} onChange={setDraft} idPrefix="add-subjectivity" />
          {add.error && (
            <Notice tone="error" title="Couldn't add it">
              {add.error.message}
            </Notice>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={add.isPending || !draft.title.trim()}>
              {add.isPending && <Spinner />}
              Add subjectivity
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Inspections the rules ordered for this quote, newest status first. */
export function InspectionsPanel({ quoteId, policyId }: { quoteId?: string; policyId?: string }) {
  const trpc = useTRPC();

  const list = useQuery(
    policyId
      ? trpc.underwriting.inspections.forPolicy.queryOptions({ policyId })
      : trpc.underwriting.inspections.forQuote.queryOptions({ quoteId: quoteId! }),
  );

  const rows = list.data ?? [];

  if (rows.length === 0) return null;

  return (
    <Panel title="Inspections" flush>
      <ul className="m-0 list-none divide-y p-0">
        {rows.map((i) => (
          <li key={i.id}>
            <Link
              to="/underwriting/inspections/$inspectionId"
              params={{ inspectionId: i.id }}
              className="flex items-start gap-3 px-(--card-p) py-3 transition-colors hover:bg-muted/40"
            >
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="text-sm leading-5 font-medium">
                  {INSPECTION_TYPES[i.type] ?? i.type}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {[
                    i.reason,
                    TIMINGS[i.timing],
                    i.scheduledFor &&
                      i.status === "scheduled" &&
                      `Scheduled ${formatDate(i.scheduledFor)}`,
                    i.completedAt && `Completed ${formatDate(i.completedAt)}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <InspectionStatus status={i.status} />
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
