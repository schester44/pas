import { Button } from "@pas/ui/components/button";
import { Checkbox } from "@pas/ui/components/checkbox";
import { EmptyState } from "@pas/ui/components/empty-state";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { Notice } from "@pas/ui/components/notice";
import { Panel } from "@pas/ui/components/panel";
import { Spinner } from "@pas/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Inbox, Plus, X } from "lucide-react";
import { useState } from "react";
import { formatDateTime, useEnvironment } from "@/lib/environment";
import { useAccess } from "@/lib/permissions";
import { useTRPC } from "@/lib/trpc";
import { BatchSheet } from "./batch-sheet";
import { BatchStatus, type Enrollment, ItemStatus, mailboxOf, TRIGGER_LABELS } from "./shared";

/** Agency → Downloads: the agency's IVANS mailbox enrollment and what was sent to it. */
export function AgencyDownloadsPanel({ agencyId }: { agencyId: string }) {
  const trpc = useTRPC();
  const view = useQuery(trpc.agencyDownloads.agency.queryOptions({ agencyId }));
  const now = useEnvironment().data?.now;
  const [batchId, setBatchId] = useState<string | null>(null);

  if (view.error) {
    return (
      <Notice tone="error" title="Couldn't load downloads">
        {view.error.message}
      </Notice>
    );
  }

  if (!view.data || !now) return <div className="h-64 animate-pulse rounded-xl bg-muted/60" />;

  return (
    <div className="grid gap-6">
      {!view.data.provider && (
        <Notice title="Agency downloads are off">
          Enable IVANS Download in{" "}
          <Link
            to="/settings/integrations/$providerId"
            params={{ providerId: "ivans_download" }}
            className="font-medium text-foreground hover:underline"
          >
            Settings → Integrations
          </Link>{" "}
          to send this agency its policies.
        </Notice>
      )}
      <EnrollmentForm
        key={view.data.enrollment?.updatedAt ?? "new"}
        agencyId={agencyId}
        enrollment={view.data.enrollment}
        today={now.slice(0, 10)}
      />
      {view.data.enrollment && (
        <>
          <Panel flush title="Sent and waiting">
            {view.data.items.length === 0 ? (
              <EmptyState
                icon={<Inbox />}
                title="Nothing yet"
                description="Issued transactions for this agency's producers queue here for the nightly batch."
              />
            ) : (
              <ul className="m-0 list-none divide-y p-0">
                {view.data.items.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between gap-4 px-(--card-p) py-3"
                  >
                    <span className="grid min-w-0 gap-0.5">
                      <span className="truncate text-sm leading-5 font-medium tabular-nums">
                        {item.title}
                      </span>
                      <span className="truncate text-xs text-muted-foreground tabular-nums">
                        {item.deliveredAt
                          ? `Delivered ${formatDateTime(item.deliveredAt)}`
                          : (item.lastError ?? `Queued ${formatDateTime(item.createdAt)}`)}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      {item.batchId && (
                        <Button size="sm" variant="ghost" onClick={() => setBatchId(item.batchId)}>
                          View file
                        </Button>
                      )}
                      <ItemStatus item={item} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel flush title="Mailbox files">
            {view.data.batches.length === 0 ? (
              <EmptyState title="No files delivered yet" />
            ) : (
              <ul className="m-0 list-none divide-y p-0">
                {view.data.batches.map((b) => (
                  <li key={b.id}>
                    <button
                      type="button"
                      onClick={() => setBatchId(b.id)}
                      className="flex w-full items-center justify-between gap-4 px-(--card-p) py-3 text-left outline-none hover:bg-muted/40 focus-visible:bg-muted/40"
                    >
                      <span className="grid min-w-0 gap-0.5">
                        <span className="truncate font-mono text-sm leading-5">{b.fileName}</span>
                        <span className="truncate text-xs text-muted-foreground tabular-nums">
                          {TRIGGER_LABELS[b.trigger]} · {b.itemCount}{" "}
                          {b.itemCount === 1 ? "item" : "items"} · {formatDateTime(b.createdAt)}
                        </span>
                      </span>
                      <BatchStatus status={b.status} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}
      <BatchSheet batchId={batchId} onOpenChange={(open) => !open && setBatchId(null)} />
    </div>
  );
}

function EnrollmentForm({
  agencyId,
  enrollment,
  today,
}: {
  agencyId: string;
  enrollment: Enrollment | null;
  today: string;
}) {
  const trpc = useTRPC();
  const access = useAccess();
  const queryClient = useQueryClient();
  const [accountCode, setAccountCode] = useState(enrollment?.accountCode ?? "");
  const [mailbox, setMailbox] = useState(enrollment?.mailbox ?? "");
  const [startDate, setStartDate] = useState(enrollment?.startDate ?? today);
  const [enabled, setEnabled] = useState(enrollment?.enabled ?? true);
  const [codes, setCodes] = useState(enrollment?.agencyCodes ?? [{ carrier: "", code: "" }]);
  const [submitted, setSubmitted] = useState(false);

  const save = useMutation(
    trpc.agencyDownloads.saveEnrollment.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.agencyDownloads.pathKey() }),
    }),
  );

  const accountInvalid = submitted && !/^Y[A-Z0-9]{4}$/i.test(accountCode.trim());
  const codesInvalid = submitted && !codes.some((c) => c.code.trim());
  const readOnly = !access.agencies.write;

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitted(true);

    if (!/^Y[A-Z0-9]{4}$/i.test(accountCode.trim()) || !codes.some((c) => c.code.trim())) return;

    save.mutate({
      agencyId,
      accountCode,
      mailbox: mailbox.trim() || null,
      agencyCodes: codes.filter((c) => c.code.trim()),
      enabled,
      startDate,
    });
  }

  return (
    <Panel
      title="IVANS mailbox"
      description="Where this agency's management system picks up its downloads."
      footer={
        !readOnly && (
          <div className="flex items-center justify-end gap-3">
            {save.isSuccess && <span className="text-sm text-muted-foreground">Saved</span>}
            <Button size="sm" type="submit" form="enrollment" disabled={save.isPending}>
              {save.isPending && <Spinner />}
              {enrollment ? "Save enrollment" : "Enroll agency"}
            </Button>
          </div>
        )
      }
    >
      <form id="enrollment" onSubmit={onSubmit} className="grid gap-4" noValidate>
        {save.error && (
          <Notice tone="error" title="Couldn't save the enrollment">
            {save.error.message}
          </Notice>
        )}
        <div className="grid items-start gap-4 sm:grid-cols-3">
          <div className="grid gap-2">
            <Label htmlFor="account-code">Account code</Label>
            <Input
              id="account-code"
              value={accountCode}
              placeholder="YAB1D"
              maxLength={5}
              disabled={readOnly}
              aria-invalid={accountInvalid}
              className="font-mono uppercase tabular-nums"
              onChange={(e) => setAccountCode(e.target.value.toUpperCase())}
            />
            <p
              className={
                accountInvalid
                  ? "m-0 text-xs text-destructive"
                  : "m-0 text-xs text-muted-foreground"
              }
            >
              {accountInvalid
                ? "Enter a Y and four letters or digits."
                : "The agency's IVANS Y-account."}
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="mailbox">
              Mailbox <span className="font-normal text-muted-foreground">optional</span>
            </Label>
            <Input
              id="mailbox"
              value={mailbox}
              maxLength={8}
              disabled={readOnly}
              className="font-mono uppercase"
              onChange={(e) => setMailbox(e.target.value.toUpperCase())}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="start-date">Start date</Label>
            <Input
              id="start-date"
              type="date"
              value={startDate}
              disabled={readOnly}
              className="tabular-nums"
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
        </div>
        <fieldset className="m-0 grid gap-2 border-0 p-0">
          <legend className="mb-2 text-sm font-medium">Agency codes</legend>
          {codes.map((code, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                aria-label="Carrier or MGA"
                placeholder="Carrier or MGA"
                value={code.carrier}
                disabled={readOnly}
                onChange={(e) =>
                  setCodes(
                    codes.map((c, i) => (i === index ? { ...c, carrier: e.target.value } : c)),
                  )
                }
              />
              <Input
                aria-label="Agency code"
                placeholder="Agency code"
                value={code.code}
                disabled={readOnly}
                aria-invalid={codesInvalid}
                className="font-mono"
                onChange={(e) =>
                  setCodes(codes.map((c, i) => (i === index ? { ...c, code: e.target.value } : c)))
                }
              />
              {!readOnly && codes.length > 1 && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="Remove code"
                  onClick={() => setCodes(codes.filter((_, i) => i !== index))}
                >
                  <X />
                </Button>
              )}
            </div>
          ))}
          {codesInvalid && (
            <p className="m-0 text-xs text-destructive">Add the agency's code with one carrier.</p>
          )}
          {!readOnly && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="w-fit"
              onClick={() => setCodes([...codes, { carrier: "", code: "" }])}
            >
              <Plus /> Add code
            </Button>
          )}
        </fieldset>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={enabled}
            disabled={readOnly}
            onCheckedChange={(checked) => setEnabled(checked === true)}
          />
          Send downloads to this mailbox
        </label>
        {enrollment && (
          <p className="m-0 text-xs text-muted-foreground tabular-nums">
            Mailbox {mailboxOf(enrollment)}
          </p>
        )}
      </form>
    </Panel>
  );
}
