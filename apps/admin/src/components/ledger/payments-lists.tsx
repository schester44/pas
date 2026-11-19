import { Button } from "@pas/ui/components/button";
import {
  Dialog,
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
import { Spinner } from "@pas/ui/components/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pas/ui/components/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, FileUp, Landmark, ReceiptText, Scale } from "lucide-react";
import { useId, useRef, useState } from "react";
import { formatDate, formatPlainDate } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";
import {
  Amount,
  money,
  PAYER_LABEL,
  PaymentStatus,
  RAIL_LABEL,
  useIdempotencyKey,
  useLedgerOverview,
  validAmount,
  WorkStatus,
} from "./shared";

const rowButton = "cursor-pointer hover:bg-muted/40";

function useInvalidate() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return () => queryClient.invalidateQueries({ queryKey: trpc.ledger.pathKey() });
}

export function PaymentsTable({ onOpen }: { onOpen: (paymentId: string) => void }) {
  const trpc = useTRPC();
  const payments = useQuery(trpc.ledger.payments.queryOptions({}));

  return (
    <Panel flush>
      {payments.data?.length === 0 ? (
        <EmptyState
          icon={<Banknote />}
          title="No payments yet"
          description="Card payments and recorded checks show up here."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Payment</TableHead>
              <TableHead>Received</TableHead>
              <TableHead>Payer</TableHead>
              <TableHead>Method</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Unapplied</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.data?.map((p) => (
              <TableRow key={p.id} className={rowButton} onClick={() => onOpen(p.id)}>
                <TableCell className="font-medium tabular-nums">{p.number}</TableCell>
                <TableCell className="tabular-nums">{formatPlainDate(p.receivedOn)}</TableCell>
                <TableCell className="max-w-56 truncate">
                  {p.payerName ??
                    (p.payerType ? (
                      PAYER_LABEL[p.payerType]
                    ) : (
                      <span className="text-muted-foreground">Unidentified</span>
                    ))}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {RAIL_LABEL[p.rail]}
                  {p.reference && ` · ${p.reference}`}
                </TableCell>
                <TableCell className="text-right">
                  <Amount value={p.amount} />
                </TableCell>
                <TableCell className="text-right">
                  <Amount value={p.unapplied} />
                </TableCell>
                <TableCell>
                  <PaymentStatus status={p.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}

export function BatchesTable() {
  const trpc = useTRPC();
  const invalidate = useInvalidate();
  const overview = useLedgerOverview();
  const batches = useQuery(trpc.ledger.batches.queryOptions());
  const [key, renewKey] = useIdempotencyKey();

  const deposit = useMutation(
    trpc.ledger.depositBatch.mutationOptions({
      onSuccess: async () => {
        renewKey();
        await invalidate();
      },
    }),
  );

  return (
    <Panel
      flush
      title="Deposit batches"
      description="Checks and lockbox items wait in undeposited funds until the batch is deposited."
    >
      {deposit.error && (
        <Notice tone="error" title="Couldn't deposit the batch" className="m-(--card-p)">
          {deposit.error.message}
        </Notice>
      )}
      {batches.data?.length === 0 ? (
        <EmptyState icon={<Landmark />} title="No deposit batches yet" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Batch</TableHead>
              <TableHead>Rail</TableHead>
              <TableHead>Opened</TableHead>
              <TableHead className="text-right">Payments</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {batches.data?.map((b) => (
              <TableRow key={b.id}>
                <TableCell className="font-medium tabular-nums">{b.number}</TableCell>
                <TableCell>{RAIL_LABEL[b.rail]}</TableCell>
                <TableCell className="tabular-nums">{formatDate(b.createdAt)}</TableCell>
                <TableCell className="text-right tabular-nums">{b.payments}</TableCell>
                <TableCell className="text-right">
                  <Amount value={b.total} />
                </TableCell>
                <TableCell>
                  {b.status === "deposited" && b.depositedOn ? (
                    <span className="text-sm tabular-nums">
                      Deposited {formatPlainDate(b.depositedOn)}
                    </span>
                  ) : (
                    <WorkStatus status={b.status} />
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {b.status === "open" && b.payments > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={deposit.isPending}
                      onClick={() =>
                        deposit.mutate({
                          batchId: b.id,
                          depositedOn: overview.data?.today ?? "",
                          idempotencyKey: key,
                        })
                      }
                    >
                      Deposit
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}

export function LockboxPanel() {
  const trpc = useTRPC();
  const invalidate = useInvalidate();
  const overview = useLedgerOverview();
  const lockbox = useQuery(trpc.ledger.lockbox.queryOptions());
  const file = useRef<HTMLInputElement>(null);
  const [key, renewKey] = useIdempotencyKey();

  const [matching, setMatching] = useState<{
    id: string;
    amount: { amount: string; currency: string };
    reason: string | null;
  } | null>(null);

  const importFile = useMutation(
    trpc.ledger.importLockbox.mutationOptions({
      onSuccess: async () => {
        renewKey();
        await invalidate();
      },
    }),
  );

  return (
    <div className="grid gap-6">
      <Panel
        flush
        title="Lockbox imports"
        description="A CSV from the bank: amount, date, check number, and an invoice, statement, loan or policy number."
        action={
          <>
            <input
              ref={file}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={async (event) => {
                const chosen = event.target.files?.[0];

                event.target.value = "";

                if (!chosen) return;

                importFile.mutate({
                  fileName: chosen.name,
                  csv: await chosen.text(),
                  currency: overview.data?.currency ?? "USD",
                  idempotencyKey: key,
                });
              }}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={importFile.isPending}
              onClick={() => file.current?.click()}
            >
              {importFile.isPending ? <Spinner /> : <FileUp />}
              Import file
            </Button>
          </>
        }
      >
        {importFile.error && (
          <Notice tone="error" title="Couldn't import the file" className="m-(--card-p)">
            {importFile.error.message}
          </Notice>
        )}
        {lockbox.data?.imports.length === 0 ? (
          <EmptyState icon={<FileUp />} title="No lockbox files imported" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead>Imported</TableHead>
                <TableHead className="text-right">Rows</TableHead>
                <TableHead className="text-right">Matched</TableHead>
                <TableHead className="text-right">Exceptions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lockbox.data?.imports.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="font-medium">{i.fileName}</TableCell>
                  <TableCell className="tabular-nums">{formatDate(i.importedAt)}</TableCell>
                  <TableCell className="text-right tabular-nums">{i.rows}</TableCell>
                  <TableCell className="text-right tabular-nums">{i.matched}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {i.exceptions === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      i.exceptions
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
      <Panel
        flush
        title="Exceptions"
        description="Held in unapplied cash until they're matched to an invoice."
      >
        {lockbox.data?.exceptions.length === 0 ? (
          <EmptyState title="No exceptions" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Row</TableHead>
                <TableHead>File</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Why it didn't match</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lockbox.data?.exceptions.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="tabular-nums">{e.row}</TableCell>
                  <TableCell className="max-w-40 truncate">{e.fileName}</TableCell>
                  <TableCell className="tabular-nums">
                    {e.reference ? `Check ${e.reference}` : (e.paymentNumber ?? "—")}
                  </TableCell>
                  <TableCell className="max-w-72 truncate text-muted-foreground">
                    {e.reason}
                  </TableCell>
                  <TableCell className="text-right">
                    <Amount value={e.amount} />
                  </TableCell>
                  <TableCell className="text-right">
                    {e.paymentId && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setMatching({ id: e.id, amount: e.amount, reason: e.reason })
                        }
                      >
                        Match
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
      <MatchDialog item={matching} onOpenChange={(open) => !open && setMatching(null)} />
    </div>
  );
}

function MatchDialog({
  item,
  onOpenChange,
}: {
  item: { id: string; amount: { amount: string; currency: string }; reason: string | null } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  const trpc = useTRPC();
  const invalidate = useInvalidate();
  const [key, renewKey] = useIdempotencyKey();
  const [search, setSearch] = useState("");

  const items = useQuery({
    ...trpc.ledger.openItems.queryOptions({ search: search.trim() }),
    enabled: item !== null && search.trim().length > 1,
  });

  const resolve = useMutation(
    trpc.ledger.resolveLockbox.mutationOptions({
      onSuccess: async () => {
        renewKey();
        setSearch("");
        await invalidate();
        onOpenChange(false);
      },
    }),
  );

  return (
    <Dialog open={item !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {item && (
          <div className="grid gap-6">
            <DialogHeader>
              <DialogTitle>Match {money(item.amount)}</DialogTitle>
              <DialogDescription>
                Pick the invoice this payment was for; it's applied at once.
              </DialogDescription>
            </DialogHeader>
            {resolve.error && (
              <Notice tone="error" title="Couldn't match the item">
                {resolve.error.message}
              </Notice>
            )}
            <div className="grid gap-2">
              <Label htmlFor={`${id}-search`}>Invoice, policy or payer</Label>
              <Input
                id={`${id}-search`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <ul className="m-0 grid max-h-64 list-none overflow-y-auto p-0">
              {items.data
                ?.filter((i) => i.kind === "invoice")
                .map((i) => (
                  <li key={i.invoiceId}>
                    <button
                      type="button"
                      disabled={resolve.isPending}
                      className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
                      onClick={() =>
                        resolve.mutate({
                          itemId: item.id,
                          invoiceId: i.invoiceId,
                          idempotencyKey: key,
                        })
                      }
                    >
                      <span className="grid gap-0.5">
                        <span className="font-medium tabular-nums">{i.number}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {i.policyNumber} · {i.payerName ?? PAYER_LABEL[i.payerType]} · due{" "}
                          {formatPlainDate(i.dueOn)}
                        </span>
                      </span>
                      <Amount value={i.balance} />
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function RefundsTable() {
  const trpc = useTRPC();
  const refunds = useQuery(trpc.ledger.refunds.queryOptions());
  const [issuing, setIssuing] = useState<{ id: string; number: string } | null>(null);

  return (
    <Panel flush>
      {refunds.data?.length === 0 ? (
        <EmptyState icon={<ReceiptText />} title="No refunds yet" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Refund</TableHead>
              <TableHead>From</TableHead>
              <TableHead>Payee</TableHead>
              <TableHead>Method</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {refunds.data?.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium tabular-nums">{r.number}</TableCell>
                <TableCell className="tabular-nums">
                  {r.invoiceNumber ?? "Unapplied cash"}
                </TableCell>
                <TableCell className="max-w-48 truncate">{r.payerName ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">
                  {r.method === "provider"
                    ? "Card"
                    : r.checkNumber
                      ? `Check ${r.checkNumber}`
                      : "Check"}
                </TableCell>
                <TableCell className="text-right">
                  <Amount value={r.amount} />
                </TableCell>
                <TableCell>
                  <WorkStatus status={r.status} />
                </TableCell>
                <TableCell className="text-right">
                  {r.status === "requested" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setIssuing({ id: r.id, number: r.number })}
                    >
                      Issue check
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <IssueCheckDialog refund={issuing} onOpenChange={(open) => !open && setIssuing(null)} />
    </Panel>
  );
}

function IssueCheckDialog({
  refund,
  onOpenChange,
}: {
  refund: { id: string; number: string } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  const trpc = useTRPC();
  const invalidate = useInvalidate();
  const [key, renewKey] = useIdempotencyKey();
  const [checkNumber, setCheckNumber] = useState("");

  const issue = useMutation(
    trpc.ledger.issueRefundCheck.mutationOptions({
      onSuccess: async () => {
        renewKey();
        setCheckNumber("");
        await invalidate();
        onOpenChange(false);
      },
    }),
  );

  return (
    <Dialog open={refund !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {refund && (
          <form
            className="grid gap-6"
            onSubmit={(event) => {
              event.preventDefault();

              issue.mutate({
                refundId: refund.id,
                checkNumber: checkNumber.trim(),
                idempotencyKey: key,
              });
            }}
          >
            <DialogHeader>
              <DialogTitle>Issue check for {refund.number}</DialogTitle>
              <DialogDescription>
                Moves the refund out of refunds payable and the operating account.
              </DialogDescription>
            </DialogHeader>
            {issue.error && (
              <Notice tone="error" title="Couldn't issue the check">
                {issue.error.message}
              </Notice>
            )}
            <div className="grid gap-2">
              <Label htmlFor={`${id}-check`}>Check number</Label>
              <Input
                id={`${id}-check`}
                className="tabular-nums"
                value={checkNumber}
                onChange={(e) => setCheckNumber(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!checkNumber.trim() || issue.isPending}>
                {issue.isPending && <Spinner />}
                Issue check
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function WriteOffsPanel() {
  const id = useId();
  const trpc = useTRPC();
  const invalidate = useInvalidate();
  const overview = useLedgerOverview();
  const writeOffs = useQuery(trpc.ledger.writeOffs.queryOptions({}));
  const [key, renewKey] = useIdempotencyKey();
  const [threshold, setThreshold] = useState<string | null>(null);

  const decide = useMutation(
    trpc.ledger.decideWriteOff.mutationOptions({
      onSuccess: async () => {
        renewKey();
        await invalidate();
      },
    }),
  );

  const settings = useMutation(
    trpc.ledger.updateSettings.mutationOptions({
      onSuccess: async () => {
        renewKey();
        setThreshold(null);
        await invalidate();
      },
    }),
  );

  const current = overview.data?.smallBalanceWriteOff;
  const value = threshold ?? (current ? Number(current.amount).toFixed(2) : "");
  const error = decide.error ?? settings.error;

  return (
    <div className="grid gap-6">
      <Panel
        title="Small balances"
        description="Write-offs at or under this amount post at once; larger ones need a second person to approve."
      >
        <form
          className="flex items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();

            settings.mutate({
              smallBalanceWriteOff: value.trim()
                ? { amount: value.trim(), currency: overview.data?.currency ?? "USD" }
                : null,
              idempotencyKey: key,
            });
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor={`${id}-threshold`}>Threshold</Label>
            <Input
              id={`${id}-threshold`}
              inputMode="decimal"
              className="w-40 tabular-nums"
              placeholder="None"
              value={value}
              onChange={(e) => setThreshold(e.target.value)}
            />
          </div>
          <Button
            type="submit"
            variant="outline"
            disabled={
              settings.isPending ||
              threshold === null ||
              (value.trim() !== "" && !validAmount(value))
            }
          >
            {settings.isPending && <Spinner />}
            Save
          </Button>
        </form>
      </Panel>
      {error && (
        <Notice tone="error" title="Couldn't save">
          {error.message}
        </Notice>
      )}
      <Panel flush title="Write-offs">
        {writeOffs.data?.length === 0 ? (
          <EmptyState icon={<Scale />} title="No write-offs" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Requested by</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {writeOffs.data?.map((w) => (
                <TableRow key={w.id}>
                  <TableCell className="font-medium tabular-nums">
                    {w.invoiceNumber}
                    <span className="block text-xs font-normal text-muted-foreground">
                      {w.policyNumber}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-64 truncate">{w.reason}</TableCell>
                  <TableCell>{w.requestedBy}</TableCell>
                  <TableCell className="text-right">
                    <Amount value={w.amount} />
                  </TableCell>
                  <TableCell>
                    <WorkStatus status={w.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    {w.status === "pending_approval" && (
                      <span className="inline-flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={decide.isPending}
                          onClick={() =>
                            decide.mutate({ writeOffId: w.id, approve: false, idempotencyKey: key })
                          }
                        >
                          Reject
                        </Button>
                        <Button
                          size="sm"
                          disabled={decide.isPending}
                          onClick={() =>
                            decide.mutate({ writeOffId: w.id, approve: true, idempotencyKey: key })
                          }
                        >
                          Approve
                        </Button>
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
