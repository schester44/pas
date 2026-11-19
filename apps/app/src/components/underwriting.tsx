import type { AppOutputs } from "@pas/api-client";
import { Button } from "@pas/ui/components/button";
import { Label } from "@pas/ui/components/label";
import { Notice } from "@pas/ui/components/notice";
import { Panel } from "@pas/ui/components/panel";
import { Spinner } from "@pas/ui/components/spinner";
import { StatusChip, type StatusTone } from "@pas/ui/components/status-chip";
import { Textarea } from "@pas/ui/components/textarea";
import { cn } from "@pas/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { formatDateTime, formatPlainDate } from "@/lib/format";
import type { Quote } from "@/lib/quotes";
import { useTRPC } from "@/lib/trpc";

type Subjectivity = AppOutputs["underwriting"]["subjectivities"][number];

const MAX_BYTES = 5 * 1024 * 1024;

const STATUS: Record<string, { label: string; tone: StatusTone }> = {
  open: { label: "To do", tone: "warning" },
  received: { label: "With underwriting", tone: "accent" },
  accepted: { label: "Accepted", tone: "success" },
  waived: { label: "Waived", tone: "neutral" },
};

const OWNER: Record<string, string> = {
  producer: "You",
  insured: "The insured",
  underwriter: "Underwriting",
};

/** The underwriter conversation on a referred quote; the producer answers here. */
export function UnderwriterMessages({ submissionId }: { submissionId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const referral = useQuery(trpc.underwriting.referral.queryOptions({ submissionId }));

  const reply = useMutation(
    trpc.underwriting.reply.mutationOptions({
      onSuccess: async () => {
        setText("");

        await queryClient.invalidateQueries({
          queryKey: trpc.underwriting.referral.queryKey({ submissionId }),
        });
      },
    }),
  );

  const data = referral.data;

  if (!data || data.messages.length === 0) return null;

  return (
    <section className="grid gap-3">
      <h3 className="m-0 text-sm font-medium">
        {data.waitingOnProducer
          ? "The underwriter needs a few details"
          : "Messages with underwriting"}
      </h3>
      <ol className="m-0 grid list-none gap-3 p-0">
        {data.messages.map((m) => (
          <li
            key={m.id}
            className={cn(
              "grid gap-1 rounded-lg px-3 py-2.5 text-sm",
              m.author.role === "producer" ? "ml-8 bg-primary/5" : "mr-8 bg-muted/60",
            )}
          >
            <span className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {m.author.role === "producer" ? "You" : m.author.name}
              </span>
              <span className="tabular-nums">{formatDateTime(m.at, { weekday: true })}</span>
            </span>
            <span className="whitespace-pre-wrap">{m.body}</span>
          </li>
        ))}
      </ol>
      {data.status !== "approved" && data.status !== "declined" && data.status !== "closed" && (
        <form
          className="grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            reply.mutate({ submissionId, message: text });
          }}
        >
          <Label htmlFor="uw-reply" className="sr-only">
            Your answer
          </Label>
          <Textarea
            id="uw-reply"
            rows={3}
            value={text}
            placeholder={
              data.waitingOnProducer ? "Answer the underwriter" : "Write to the underwriter"
            }
            onChange={(e) => setText(e.target.value)}
          />
          {reply.error && (
            <Notice tone="error" title="Couldn't send it">
              {reply.error.message}
            </Notice>
          )}
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={reply.isPending || !text.trim()}>
              {reply.isPending && <Spinner />}
              Send
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

const amountText = (a?: { kind: string; amount?: string; value?: string }) =>
  !a ? null : a.kind === "money" ? `$${Number(a.amount).toLocaleString()}` : `${a.value}%`;

/** What the underwriter changed when approving, in plain words. */
export function approvalChanges(quote: Quote): string[] {
  const m = quote.referral?.decision?.modifications;

  if (!m) return [];

  const names = new Map(quote.coverages.map((c) => [c.code, c.name]));

  return [
    ...m.coverages.map((c) =>
      [
        names.get(c.coverage) ?? c.coverage,
        c.limit && `limit ${amountText(c.limit)}`,
        c.deductible && `deductible ${amountText(c.deductible)}`,
      ]
        .filter(Boolean)
        .join(", "),
    ),
    ...(m.adjustment
      ? [
          `${Number(m.adjustment.percent) >= 0 ? "Premium loading" : "Premium credit"} of ${Math.abs(Number(m.adjustment.percent))}%: ${m.adjustment.reason}`,
        ]
      : []),
  ];
}

function dueText(s: Subjectivity) {
  if (s.dueDate) return `Due ${formatPlainDate(s.dueDate)}`;

  if (s.timing === "pre_bind") return "Needed before binding";

  return s.dueDays !== null ? `Due ${s.dueDays} days after binding` : "After binding";
}

/** Subjectivities on the quote or policy, with uploads for the producer. */
export function SubjectivitiesList({
  submissionId,
  policyId,
  title = "Subjectivities",
}: {
  submissionId?: string;
  policyId?: string;
  title?: string;
}) {
  const trpc = useTRPC();

  const list = useQuery(
    policyId
      ? trpc.underwriting.policySubjectivities.queryOptions({ policyId })
      : trpc.underwriting.subjectivities.queryOptions({ submissionId: submissionId! }),
  );

  const rows = list.data ?? [];

  if (rows.length === 0) return null;

  return (
    <Panel
      title={title}
      description="Conditions of the offer. Upload what each one asks for; underwriting reviews it."
      flush
    >
      <ul className="m-0 list-none divide-y p-0">
        {rows.map((s) => (
          <SubjectivityRow key={s.id} subjectivity={s} submissionId={s.submissionId} />
        ))}
      </ul>
    </Panel>
  );
}

function SubjectivityRow({
  subjectivity: s,
  submissionId,
}: {
  subjectivity: Subjectivity;
  submissionId: string;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const status =
    s.overdue && s.status === "open"
      ? { label: "Overdue", tone: "danger" as const }
      : STATUS[s.status];

  const upload = useMutation(
    trpc.underwriting.upload.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.underwriting.pathKey() }),
      onError: (e) => setError(e.message),
    }),
  );

  async function onFile(file: File | undefined) {
    if (!file) return;

    if (file.size > MAX_BYTES) {
      setError("Files can be up to 5 MB.");

      return;
    }

    setError(null);

    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";

    for (const byte of bytes) binary += String.fromCharCode(byte);

    upload.mutate({
      submissionId,
      subjectivityId: s.id,
      file: {
        name: file.name,
        contentType: file.type || "application/octet-stream",
        base64: btoa(binary),
      },
    });
  }

  const canUpload = (s.status === "open" || s.status === "received") && s.owner !== "underwriter";

  return (
    <li className="grid gap-2 px-(--card-p) py-3">
      <div className="flex items-start gap-3">
        <div className="grid min-w-0 flex-1 gap-0.5">
          <span className="text-sm leading-5 font-medium">{s.title}</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {dueText(s)} · {OWNER[s.owner] ?? s.owner}
          </span>
        </div>
        {status && <StatusChip tone={status.tone}>{status.label}</StatusChip>}
      </div>
      {s.documents.length > 0 && (
        <ul className="m-0 grid list-none gap-1 p-0">
          {s.documents.map((d) => (
            <li key={d.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <FileText className="size-3.5" /> {d.name}
            </li>
          ))}
        </ul>
      )}
      {canUpload && (
        <div>
          <input
            ref={input}
            type="file"
            className="sr-only"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={upload.isPending}
            onClick={() => input.current?.click()}
          >
            {upload.isPending ? <Spinner /> : <Upload />}
            Upload
          </Button>
        </div>
      )}
      {error && <p className="m-0 text-xs text-red-700">{error}</p>}
    </li>
  );
}
