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
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import { SegmentedControl } from "@pas/ui/components/segmented-control";
import { Spinner } from "@pas/ui/components/spinner";
import { Textarea } from "@pas/ui/components/textarea";
import { cn } from "@pas/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Download } from "lucide-react";
import type * as React from "react";
import { useId, useState } from "react";
import { Breadcrumb } from "@/components/catalog/breadcrumb";
import {
  downloadFile,
  kindLabel,
  type ObligationDetail,
  ObligationState,
  stateLabel,
} from "@/components/compliance/labels";
import { formatDate, formatMoney, formatPlainDate } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/compliance/$obligationId")({
  component: ObligationPage,
});

type Action = "mark" | "answer" | "correct" | "waive" | null;

const FROM: Record<string, string> = {
  effective: "the effective date",
  issue: "the issue date",
  later_of_effective_issue: "the later of the effective and issue dates",
  period_end: "the end of the period",
};

function ObligationPage() {
  const { obligationId } = Route.useParams();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const obligation = useQuery(trpc.compliance.get.queryOptions({ id: obligationId }));
  const [action, setAction] = useState<Action>(null);

  const refresh = (updated?: ObligationDetail) => {
    if (updated)
      queryClient.setQueryData(trpc.compliance.get.queryKey({ id: obligationId }), updated);

    return queryClient.invalidateQueries({ queryKey: trpc.compliance.pathKey() });
  };

  const submit = useMutation(trpc.compliance.submit.mutationOptions({ onSuccess: refresh }));
  const o = obligation.data;

  return (
    <>
      <PageHeader
        title={
          <Breadcrumb
            parents={[
              <Link key="c" to="/compliance">
                Compliance
              </Link>,
            ]}
            current={o ? o.title : undefined}
          />
        }
        actions={
          o && (
            <Actions
              obligation={o}
              submitting={submit.isPending}
              onSubmit={() => submit.mutate({ obligationId })}
              onAction={setAction}
            />
          )
        }
      />
      <PageBody className="max-w-6xl">
        {obligation.error && (
          <Notice tone="error" title="Couldn't load this obligation">
            {obligation.error.message}
          </Notice>
        )}
        {submit.error && (
          <Notice tone="error" title="Couldn't submit">
            {submit.error.message}
          </Notice>
        )}
        {o?.overdue && (
          <p className="m-0 flex items-center gap-2 text-sm text-red-800">
            <span aria-hidden className="size-1.5 rounded-full bg-red-500" />
            Overdue since {formatPlainDate(o.dueDate)}
            {o.escalation >= 3 ? "; escalated to the compliance manager." : "."}
          </p>
        )}
        {o && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="grid content-start gap-6">
              <Summary obligation={o} />
              <Filings obligation={o} />
              {o.subject.type === "period" ? (
                <Remittance obligation={o} />
              ) : (
                <Filed obligation={o} />
              )}
            </div>
            <div className="grid content-start gap-6">
              <Proof obligation={o} />
              <Timeline obligation={o} />
            </div>
          </div>
        )}
      </PageBody>
      {o && (
        <ActionDialog
          action={action}
          obligation={o}
          onClose={() => setAction(null)}
          onDone={refresh}
        />
      )}
    </>
  );
}

function Actions({
  obligation: o,
  submitting,
  onSubmit,
  onAction,
}: {
  obligation: ObligationDetail;
  submitting: boolean;
  onSubmit: () => void;
  onAction: (action: Action) => void;
}) {
  const open = ["pending", "corrected"].includes(o.status);
  const waivable = ["pending", "in_progress", "rejected", "corrected"].includes(o.status);
  const latest = o.filings.at(-1);
  const awaitingManual = o.status === "submitted" && latest?.delivery !== "api";

  return (
    <>
      {waivable && (
        <Button variant="ghost" onClick={() => onAction("waive")}>
          Waive
        </Button>
      )}
      {(open || o.status === "in_progress") && (
        <Button
          variant={o.status === "in_progress" ? "default" : "outline"}
          onClick={() => onAction("mark")}
        >
          Mark submitted
        </Button>
      )}
      {open && (
        <Button disabled={submitting} onClick={onSubmit}>
          {submitting && <Spinner />}
          {o.status === "corrected" ? "Resubmit" : "Submit"}
        </Button>
      )}
      {o.status === "rejected" && (
        <Button onClick={() => onAction("correct")}>Correct and resubmit</Button>
      )}
      {awaitingManual && <Button onClick={() => onAction("answer")}>Record answer</Button>}
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="m-0 text-sm">{children}</dd>
    </div>
  );
}

const transaction = (type: string | null) => (type ?? "").toLowerCase().replaceAll("_", " ");

function Summary({ obligation: o }: { obligation: ObligationDetail }) {
  const days = `${o.rule.days} ${o.rule.businessDays ? "business days" : "days"}`;

  return (
    <Panel title={kindLabel(o.kind)} action={<ObligationState obligation={o} />}>
      <dl className="m-0 grid gap-3">
        <Row label="State">{stateLabel(o.jurisdiction)}</Row>
        {o.subject.type === "period" ? (
          <Row label="Period">
            <span className="tabular-nums">
              {formatPlainDate(o.subject.periodStart!)} – {formatPlainDate(o.subject.periodEnd!)}
            </span>
          </Row>
        ) : (
          <Row label="Policy">
            <Link
              to="/policies/$policyId"
              params={{ policyId: o.subject.policyId! }}
              className="font-medium tabular-nums hover:underline"
            >
              {o.subject.policyNumber}
            </Link>
            <span className="text-muted-foreground">
              {" "}
              · {transaction(o.subject.transactionType)}
            </span>
          </Row>
        )}
        <Row label="Due">
          <span className={cn("tabular-nums", o.overdue && "text-red-700")}>
            {formatPlainDate(o.dueDate)}
          </span>
          <span className="text-muted-foreground">
            {" "}
            · {days} after {FROM[o.rule.from] ?? o.rule.from}
          </span>
        </Row>
        <Row label="Responsible">
          {o.responsible.name}
          {o.responsible.licenseNumber && (
            <span className="text-muted-foreground tabular-nums">
              {" "}
              · license {o.responsible.licenseNumber}
            </span>
          )}
          {o.data.licenseeMissing === true && (
            <span className="text-amber-800"> · no licensee on record for {o.jurisdiction}</span>
          )}
        </Row>
        <Row label="Delivery">{o.channel.replaceAll("_", " ")}</Row>
        <Row label="Decided by">
          <code className="font-mono text-[0.8125rem]">{o.source.decision}</code>
        </Row>
      </dl>
    </Panel>
  );
}

const PROVIDERS: Record<string, string> = {
  test_filing: "Test filing office",
  file_export: "File export",
  slai: "SLAI",
  manual: "By hand",
};

function Filings({ obligation: o }: { obligation: ObligationDetail }) {
  if (o.filings.length === 0) return null;

  return (
    <Panel title="Filings" flush>
      <ul className="m-0 list-none divide-y p-0">
        {o.filings.toReversed().map((f) => (
          <li key={f.id} className="grid gap-1 px-(--card-p) py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm leading-5 font-medium">
                Attempt {f.attempt} · {PROVIDERS[f.providerId] ?? f.providerId}
              </span>
              <span
                className={cn(
                  "text-xs font-medium",
                  f.status === "rejected"
                    ? "text-amber-800"
                    : f.status === "accepted"
                      ? "text-emerald-800"
                      : "text-muted-foreground",
                )}
              >
                {f.status === "exported"
                  ? "Awaiting upload"
                  : f.status.charAt(0).toUpperCase() + f.status.slice(1)}
              </span>
            </div>
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatDate(f.submittedAt)}
              {f.filingNumber && ` · ${f.filingNumber}`}
              {f.stampNumber && ` · stamp ${f.stampNumber}`}
              {f.reference && !f.filingNumber && ` · ref ${f.reference}`}
            </span>
            {f.reasons.length > 0 && (
              <p className="m-0 text-sm text-amber-900">{f.reasons.join("; ")}</p>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Filed({ obligation: o }: { obligation: ObligationDetail }) {
  const r = o.request;

  const affidavit = o.data.affidavit as
    | { declinations?: { carrier: string; declinedOn: string; reason: string }[] }
    | undefined;

  return (
    <Panel
      title="What gets filed"
      description={r.correction ? `Correction: ${r.correction}` : undefined}
    >
      <dl className="m-0 grid gap-3">
        <Row label="Insured">{r.insuredName}</Row>
        <Row label="Term">
          <span className="tabular-nums">
            {r.effectiveDate && formatPlainDate(r.effectiveDate)} –{" "}
            {r.expirationDate && formatPlainDate(r.expirationDate)}
          </span>
        </Row>
        <Row label="Issued">
          {r.issuedDate && <span className="tabular-nums">{formatPlainDate(r.issuedDate)}</span>}
        </Row>
        {r.premium && (
          <Row label="Premium">
            <span className="tabular-nums">
              {formatMoney(r.premium.amount, r.premium.currency)}
            </span>
          </Row>
        )}
        {r.taxesFees.map((t) => (
          <Row key={t.code} label={t.label}>
            <span className="tabular-nums">{formatMoney(t.amount.amount, t.amount.currency)}</span>
          </Row>
        ))}
        {affidavit?.declinations && (
          <Row label="Declinations">
            {affidavit.declinations.length === 0 ? (
              <span className="text-muted-foreground">None captured</span>
            ) : (
              <ul className="m-0 grid list-none gap-1 p-0">
                {affidavit.declinations.map((d) => (
                  <li key={`${d.carrier}${d.declinedOn}`}>
                    {d.carrier}{" "}
                    <span className="text-muted-foreground tabular-nums">
                      · {formatPlainDate(d.declinedOn)} · {d.reason}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Row>
        )}
      </dl>
    </Panel>
  );
}

function Remittance({ obligation: o }: { obligation: ObligationDetail }) {
  const trpc = useTRPC();
  const report = useQuery(trpc.compliance.remittanceReport.queryOptions({ obligationId: o.id }));
  const s = report.data?.summary;

  return (
    <Panel
      title="Remittance report"
      description="Every filed transaction in the period and the taxes the licensee remits."
      action={
        report.data && (
          <Button size="sm" variant="outline" onClick={() => downloadFile(report.data)}>
            <Download /> Download CSV
          </Button>
        )
      }
    >
      {!s ? (
        <div className="h-16 animate-pulse rounded-lg bg-muted" />
      ) : (
        <dl className="m-0 grid gap-3">
          <Row label="Transactions">
            <span className="tabular-nums">{s.transactions}</span>
          </Row>
          <Row label="Premium">
            <span className="tabular-nums">
              {formatMoney(s.premium.amount, s.premium.currency)}
            </span>
          </Row>
          {s.taxes.map((t) => (
            <Row key={t.code} label={t.label}>
              <span className="tabular-nums">
                {formatMoney(t.amount.amount, t.amount.currency)}
              </span>
            </Row>
          ))}
          <Row label="Total to remit">
            <span className="font-semibold tabular-nums">
              {formatMoney(s.total.amount, s.total.currency)}
            </span>
          </Row>
        </dl>
      )}
    </Panel>
  );
}

function Proof({ obligation: o }: { obligation: ObligationDetail }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const download = async (key: string) =>
    downloadFile(
      await queryClient.fetchQuery(trpc.compliance.proofFile.queryOptions({ id: o.id, key })),
    );

  return (
    <Panel title="Proof">
      {o.waiver ? (
        <p className="m-0 text-sm">
          Waived by {o.waiver.approver} on {formatDate(o.waiver.waivedAt)}:{" "}
          <span className="text-muted-foreground">{o.waiver.reason}</span>
        </p>
      ) : !o.proof ? (
        <p className="m-0 text-sm text-muted-foreground">Nothing recorded yet.</p>
      ) : (
        <dl className="m-0 grid gap-3">
          {o.proof.filingNumber && (
            <div className="grid gap-1">
              <dt className="text-xs text-muted-foreground">Filing number</dt>
              <dd className="m-0 text-base font-semibold tabular-nums">{o.proof.filingNumber}</dd>
            </div>
          )}
          {o.proof.note && <p className="m-0 text-sm text-muted-foreground">{o.proof.note}</p>}
          {o.proof.files.map((f) => (
            <Button
              key={f.key}
              size="sm"
              variant="outline"
              className="w-fit"
              onClick={() => download(f.key)}
            >
              <Download /> {f.name}
            </Button>
          ))}
        </dl>
      )}
    </Panel>
  );
}

function Timeline({ obligation: o }: { obligation: ObligationDetail }) {
  return (
    <Panel title="Timeline">
      <ol className="m-0 grid list-none gap-4 p-0">
        {o.events.map((e) => (
          <li key={e.id} className="grid gap-0.5">
            <span className="text-sm leading-5">{e.summary}</span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatDate(e.occurredAt)} · {e.actor}
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

const fileToBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener("load", () =>
      resolve(String(reader.result).replace(/^data:[^,]*,/, "")),
    );

    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });

function ActionDialog({
  action,
  obligation,
  onClose,
  onDone,
}: {
  action: Action;
  obligation: ObligationDetail;
  onClose: () => void;
  onDone: (updated?: ObligationDetail) => Promise<unknown>;
}) {
  return (
    <Dialog open={action !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {action === "mark" && (
          <MarkSubmitted obligation={obligation} onDone={(u) => onDone(u).then(onClose)} />
        )}
        {action === "answer" && (
          <RecordAnswer obligation={obligation} onDone={(u) => onDone(u).then(onClose)} />
        )}
        {action === "correct" && (
          <Correct obligation={obligation} onDone={(u) => onDone(u).then(onClose)} />
        )}
        {action === "waive" && (
          <Waive obligation={obligation} onDone={(u) => onDone(u).then(onClose)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  optional,
  children,
}: {
  label: string;
  optional?: boolean;
  children: (id: string) => React.ReactNode;
}) {
  const id = useId();

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>
        {label}
        {optional && <span className="font-normal text-muted-foreground">Optional</span>}
      </Label>
      {children(id)}
    </div>
  );
}

function Footer({ busy, label, error }: { busy: boolean; label: string; error?: string }) {
  return (
    <>
      {error && (
        <Notice tone="error" title="Couldn't save">
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
          {label}
        </Button>
      </DialogFooter>
    </>
  );
}

type Done = { onDone: (updated: ObligationDetail) => void };

function MarkSubmitted({ obligation, onDone }: { obligation: ObligationDetail } & Done) {
  const trpc = useTRPC();
  const [filingNumber, setFilingNumber] = useState("");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const mark = useMutation(trpc.compliance.markSubmitted.mutationOptions({ onSuccess: onDone }));

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();

    mark.mutate({
      obligationId: obligation.id,
      ...(filingNumber.trim() && { filingNumber }),
      ...(note.trim() && { note }),
      files: await Promise.all(
        files.map(async (f) => ({
          name: f.name,
          contentType: f.type || "application/octet-stream",
          base64: await fileToBase64(f),
        })),
      ),
    });
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-6">
      <DialogHeader>
        <DialogTitle>Mark submitted</DialogTitle>
        <DialogDescription>
          Record a filing made on the portal, with its confirmation.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        <Field label="Confirmation number" optional>
          {(id) => (
            <Input
              id={id}
              value={filingNumber}
              className="tabular-nums"
              onChange={(e) => setFilingNumber(e.target.value)}
            />
          )}
        </Field>
        <Field label="Proof" optional>
          {(id) => (
            <Input
              id={id}
              type="file"
              multiple
              onChange={(e) => setFiles([...(e.target.files ?? [])].slice(0, 5))}
            />
          )}
        </Field>
        <Field label="Note" optional>
          {(id) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
      </div>
      <Footer busy={mark.isPending} label="Mark submitted" error={mark.error?.message} />
    </form>
  );
}

function RecordAnswer({ obligation, onDone }: { obligation: ObligationDetail } & Done) {
  const trpc = useTRPC();
  const [outcome, setOutcome] = useState<"accepted" | "rejected">("accepted");
  const [filingNumber, setFilingNumber] = useState(obligation.proof?.filingNumber ?? "");
  const [reason, setReason] = useState("");
  const record = useMutation(trpc.compliance.recordResponse.mutationOptions({ onSuccess: onDone }));

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();

    record.mutate(
      outcome === "accepted"
        ? { obligationId: obligation.id, outcome, ...(filingNumber.trim() && { filingNumber }) }
        : { obligationId: obligation.id, outcome, reasons: [reason] },
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-6">
      <DialogHeader>
        <DialogTitle>Record the answer</DialogTitle>
        <DialogDescription>What the office said about this filing.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        <SegmentedControl
          label="Outcome"
          value={outcome}
          onValueChange={setOutcome}
          options={[
            { value: "accepted", label: "Accepted" },
            { value: "rejected", label: "Rejected" },
          ]}
        />
        {outcome === "accepted" ? (
          <Field label="Filing number" optional>
            {(id) => (
              <Input
                id={id}
                value={filingNumber}
                className="tabular-nums"
                onChange={(e) => setFilingNumber(e.target.value)}
              />
            )}
          </Field>
        ) : (
          <Field label="Reason">
            {(id) => (
              <Textarea
                id={id}
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
          </Field>
        )}
      </div>
      <Footer busy={record.isPending} label="Save answer" error={record.error?.message} />
    </form>
  );
}

function Correct({ obligation, onDone }: { obligation: ObligationDetail } & Done) {
  const trpc = useTRPC();
  const [note, setNote] = useState("");
  const [insuredName, setInsuredName] = useState(obligation.request.insuredName ?? "");
  const correct = useMutation(trpc.compliance.correct.mutationOptions());
  const submit = useMutation(trpc.compliance.submit.mutationOptions({ onSuccess: onDone }));
  const reasons = obligation.filings.at(-1)?.reasons ?? [];

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();

    const changed = insuredName.trim() !== (obligation.request.insuredName ?? "");

    await correct.mutateAsync({
      obligationId: obligation.id,
      note,
      corrections: changed ? { insuredName } : {},
    });

    submit.mutate({ obligationId: obligation.id });
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-6">
      <DialogHeader>
        <DialogTitle>Correct and resubmit</DialogTitle>
        <DialogDescription>
          {reasons.join("; ") || "Fix what the office rejected, then file again."}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        <Field label="Insured name as filed">
          {(id) => (
            <Input id={id} value={insuredName} onChange={(e) => setInsuredName(e.target.value)} />
          )}
        </Field>
        <Field label="What was corrected">
          {(id) => (
            <Textarea id={id} required value={note} onChange={(e) => setNote(e.target.value)} />
          )}
        </Field>
      </div>
      <Footer
        busy={correct.isPending || submit.isPending}
        label="Resubmit"
        error={(correct.error ?? submit.error)?.message}
      />
    </form>
  );
}

function Waive({ obligation, onDone }: { obligation: ObligationDetail } & Done) {
  const trpc = useTRPC();
  const [reason, setReason] = useState("");
  const waive = useMutation(trpc.compliance.waive.mutationOptions({ onSuccess: onDone }));

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        waive.mutate({ obligationId: obligation.id, reason });
      }}
      className="grid gap-6"
    >
      <DialogHeader>
        <DialogTitle>Waive {obligation.title.toLowerCase()}</DialogTitle>
        <DialogDescription>
          Waivers keep the reason and your name as the approver.
        </DialogDescription>
      </DialogHeader>
      <Field label="Reason">
        {(id) => (
          <Textarea id={id} required value={reason} onChange={(e) => setReason(e.target.value)} />
        )}
      </Field>
      <Footer busy={waive.isPending} label="Waive" error={waive.error?.message} />
    </form>
  );
}
