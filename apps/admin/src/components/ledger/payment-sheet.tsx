import type { AdminOutputs } from "@pas/api-client";
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
import { SegmentedControl } from "@pas/ui/components/segmented-control";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@pas/ui/components/sheet";
import { Spinner } from "@pas/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";
import { formatPlainDate } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";
import {
  Amount,
  money,
  PaymentStatus,
  PAYER_LABEL,
  RAIL_LABEL,
  useIdempotencyKey,
  validAmount,
} from "./shared";

type Payment = AdminOutputs["ledger"]["payment"];

const REASONS = [
  { value: "nsf", label: "NSF" },
  { value: "chargeback", label: "Chargeback" },
  { value: "stop_payment", label: "Stop payment" },
  { value: "error", label: "Recorded in error" },
] as const;

type Reason = (typeof REASONS)[number]["value"];

function useInvalidateLedger() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return () => queryClient.invalidateQueries({ queryKey: trpc.ledger.pathKey() });
}

/** One payment: where it was applied, what's unapplied, and the moves finance can make on it. */
export function PaymentSheet({
  paymentId,
  onOpenChange,
}: {
  paymentId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const trpc = useTRPC();
  const invalidate = useInvalidateLedger();
  const [reversing, setReversing] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const [key, renewKey] = useIdempotencyKey();

  const payment = useQuery({
    ...trpc.ledger.payment.queryOptions({ id: paymentId ?? "" }),
    enabled: Boolean(paymentId),
  });

  const unapply = useMutation(
    trpc.ledger.unapplyPayment.mutationOptions({
      onSuccess: async () => {
        renewKey();
        await invalidate();
      },
    }),
  );

  const p = payment.data;
  const live = p && p.status !== "reversed";

  return (
    <Sheet open={paymentId !== null} onOpenChange={onOpenChange}>
      <SheetContent>
        {p && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-3 tabular-nums">
                {p.number}
                <PaymentStatus status={p.status} />
              </SheetTitle>
              <SheetDescription className="tabular-nums">
                {RAIL_LABEL[p.rail]}
                {p.reference && ` · ${p.reference}`} · received {formatPlainDate(p.receivedOn)}
              </SheetDescription>
            </SheetHeader>
            <SheetBody className="grid gap-6">
              {unapply.error && (
                <Notice tone="error" title="Couldn't unapply">
                  {unapply.error.message}
                </Notice>
              )}
              <dl className="m-0 grid gap-1.5 text-sm">
                <Row label="Payer">
                  {p.payerName ?? (p.payerType ? PAYER_LABEL[p.payerType] : "Unidentified")}
                </Row>
                <Row label="Amount">{money(p.amount)}</Row>
                <Row label="Applied">
                  <Amount value={p.applied} />
                </Row>
                {Number(p.refunded.amount) > 0 && (
                  <Row label="Refunded">
                    <Amount value={p.refunded} />
                  </Row>
                )}
                <Row label="Unapplied" strong>
                  <Amount value={p.unapplied} />
                </Row>
                {p.batchNumber && <Row label="Deposit batch">{p.batchNumber}</Row>}
                {p.reversalReason && <Row label="Reversed">{p.reversalReason}</Row>}
              </dl>
              <section className="grid gap-2">
                <h3 className="m-0 text-xs font-medium text-muted-foreground">Applications</h3>
                {p.applications.length === 0 ? (
                  <p className="m-0 text-sm text-muted-foreground">Not applied to anything yet.</p>
                ) : (
                  <ul className="m-0 list-none divide-y rounded-lg border p-0">
                    {p.applications.map((a) => (
                      <li key={a.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                        <span className="grid min-w-0 flex-1 gap-0.5">
                          <span className="font-medium tabular-nums">{a.invoiceNumber}</span>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {a.policyNumber}
                            {a.statementId && " · statement"}
                            {a.status === "reversed" && " · reversed"}
                          </span>
                        </span>
                        <Amount
                          value={a.amount}
                          className={a.status === "reversed" ? "line-through" : ""}
                        />
                        {live && a.status === "active" && !a.statementId && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={unapply.isPending}
                            onClick={() =>
                              unapply.mutate({
                                paymentId: p.id,
                                applicationId: a.id,
                                idempotencyKey: key,
                              })
                            }
                          >
                            Unapply
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              {live && (
                <div className="flex flex-wrap gap-2">
                  {Number(p.unapplied.amount) > 0 && (
                    <Button asChild>
                      <Link to="/billing/apply" search={{ paymentId: p.id }}>
                        Apply cash
                      </Link>
                    </Button>
                  )}
                  {Number(p.unapplied.amount) > 0 && (
                    <Button variant="outline" onClick={() => setRefunding(true)}>
                      Refund unapplied
                    </Button>
                  )}
                  {Number(p.refunded.amount) === 0 && (
                    <Button variant="outline" onClick={() => setReversing(true)}>
                      Reverse payment
                    </Button>
                  )}
                </div>
              )}
            </SheetBody>
            <ReverseDialog payment={p} open={reversing} onOpenChange={setReversing} />
            <RefundDialog
              open={refunding}
              onOpenChange={setRefunding}
              source={{ kind: "unapplied", paymentId: p.id }}
              label={`unapplied cash on ${p.number}`}
              available={p.unapplied}
              card={p.rail === "card"}
            />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Row({
  label,
  children,
  strong,
}: {
  label: string;
  children: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <div
      className={
        strong ? "flex justify-between font-medium" : "flex justify-between text-muted-foreground"
      }
    >
      <dt>{label}</dt>
      <dd className="m-0 text-foreground tabular-nums">{children}</dd>
    </div>
  );
}

function ReverseDialog({
  payment,
  open,
  onOpenChange,
}: {
  payment: Payment;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  const trpc = useTRPC();
  const invalidate = useInvalidateLedger();
  const [key, renewKey] = useIdempotencyKey();
  const [reason, setReason] = useState<Reason>("nsf");
  const [note, setNote] = useState("");

  const reverse = useMutation(
    trpc.ledger.reversePayment.mutationOptions({
      onSuccess: async () => {
        renewKey();
        await invalidate();
        onOpenChange(false);
      },
    }),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="grid gap-6"
          onSubmit={(event) => {
            event.preventDefault();

            reverse.mutate({
              paymentId: payment.id,
              reason,
              ...(note.trim() && { note: note.trim() }),
              idempotencyKey: key,
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>Reverse {payment.number}</DialogTitle>
            <DialogDescription>
              {money(payment.amount)} comes off every invoice it paid, and those invoices are owed
              again.
            </DialogDescription>
          </DialogHeader>
          {reverse.error && (
            <Notice tone="error" title="Couldn't reverse the payment">
              {reverse.error.message}
            </Notice>
          )}
          <div className="grid gap-4">
            <SegmentedControl
              label="Reason"
              value={reason}
              onValueChange={setReason}
              options={REASONS}
            />
            <div className="grid gap-2">
              <Label htmlFor={`${id}-note`}>
                Note <span className="font-normal text-muted-foreground">optional</span>
              </Label>
              <Input
                id={`${id}-note`}
                placeholder="Bank return code R01"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={reverse.isPending}>
              {reverse.isPending && <Spinner />}
              Reverse payment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Pays back a credit balance or unapplied cash: to the card, or as a check request. */
export function RefundDialog({
  open,
  onOpenChange,
  source,
  label,
  available,
  card,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: { kind: "credit_balance"; invoiceId: string } | { kind: "unapplied"; paymentId: string };
  label: string;
  available: { amount: string; currency: string };
  card: boolean;
}) {
  const id = useId();
  const trpc = useTRPC();
  const invalidate = useInvalidateLedger();
  const [key, renewKey] = useIdempotencyKey();
  const [method, setMethod] = useState<"provider" | "check">(card ? "provider" : "check");
  const [amount, setAmount] = useState("");

  const refund = useMutation(
    trpc.ledger.refund.mutationOptions({
      onSuccess: async () => {
        renewKey();
        setAmount("");
        await invalidate();
        onOpenChange(false);
      },
    }),
  );

  const value = amount.trim() || Number(available.amount).toFixed(2);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="grid gap-6"
          onSubmit={(event) => {
            event.preventDefault();

            if (!validAmount(value)) return;

            refund.mutate({
              source,
              amount: { amount: value, currency: available.currency },
              method,
              idempotencyKey: key,
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>Refund</DialogTitle>
            <DialogDescription>
              Pays back {label}, up to {money(available)}.
            </DialogDescription>
          </DialogHeader>
          {refund.error && (
            <Notice tone="error" title="Couldn't refund">
              {refund.error.message}
            </Notice>
          )}
          <div className="grid gap-4">
            <SegmentedControl
              label="Refund by"
              value={method}
              onValueChange={setMethod}
              options={[
                { value: "provider", label: "Card on file" },
                { value: "check", label: "Check request" },
              ]}
            />
            <div className="grid gap-2">
              <Label htmlFor={`${id}-amount`}>Amount</Label>
              <Input
                id={`${id}-amount`}
                inputMode="decimal"
                className="tabular-nums"
                placeholder={Number(available.amount).toFixed(2)}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={refund.isPending || !validAmount(value)}>
              {refund.isPending && <Spinner />}
              {method === "provider" ? "Refund to card" : "Request check"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
