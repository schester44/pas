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
import { Spinner } from "@pas/ui/components/spinner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useTRPC } from "@/lib/trpc";
import { money, type MoneyJson, useIdempotencyKey, validAmount } from "./shared";

export interface OpenItem {
  invoiceId: string;
  number: string;
  balance: MoneyJson;
}

/** Writes off what's left on an invoice; over the small-balance threshold it waits for approval. */
export function WriteOffDialog({
  item,
  onOpenChange,
}: {
  item: OpenItem | null;
  onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [key, renewKey] = useIdempotencyKey();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<string | null>(null);

  const writeOff = useMutation(
    trpc.ledger.requestWriteOff.mutationOptions({
      onSuccess: async (r) => {
        renewKey();
        await queryClient.invalidateQueries({ queryKey: trpc.ledger.pathKey() });

        if (r.status === "pending_approval") {
          setResult("Sent for approval: it's over the small-balance threshold.");

          return;
        }

        close();
      },
    }),
  );

  const close = () => {
    setAmount("");
    setReason("");
    setResult(null);
    writeOff.reset();
    onOpenChange(false);
  };

  const value = item ? amount.trim() || Number(item.balance.amount).toFixed(2) : "";

  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent>
        {item && (
          <form
            className="grid gap-6"
            onSubmit={(event) => {
              event.preventDefault();

              if (!validAmount(value) || !reason.trim()) return;

              writeOff.mutate({
                invoiceId: item.invoiceId,
                amount: { amount: value, currency: item.balance.currency },
                reason: reason.trim(),
                idempotencyKey: key,
              });
            }}
          >
            <DialogHeader>
              <DialogTitle>Write off {item.number}</DialogTitle>
              <DialogDescription>{money(item.balance)} is open.</DialogDescription>
            </DialogHeader>
            {writeOff.error && (
              <Notice tone="error" title="Couldn't write it off">
                {writeOff.error.message}
              </Notice>
            )}
            {result && <Notice title="Waiting for approval">{result}</Notice>}
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor={`${id}-amount`}>Amount</Label>
                <Input
                  id={`${id}-amount`}
                  inputMode="decimal"
                  className="tabular-nums"
                  placeholder={Number(item.balance.amount).toFixed(2)}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`${id}-reason`}>Reason</Label>
                <Input
                  id={`${id}-reason`}
                  placeholder="Small balance after payment"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                {result ? "Done" : "Cancel"}
              </Button>
              {!result && (
                <Button
                  type="submit"
                  disabled={writeOff.isPending || !validAmount(value) || !reason.trim()}
                >
                  {writeOff.isPending && <Spinner />}
                  Write off
                </Button>
              )}
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Uses a credit note's credit to pay one of the payer's open invoices. */
export function ApplyCreditDialog({
  credit,
  invoices,
  onOpenChange,
}: {
  credit: OpenItem | null;
  invoices: readonly OpenItem[];
  onOpenChange: (open: boolean) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [key, renewKey] = useIdempotencyKey();

  const apply = useMutation(
    trpc.ledger.applyCredit.mutationOptions({
      onSuccess: async () => {
        renewKey();
        await queryClient.invalidateQueries({ queryKey: trpc.ledger.pathKey() });
        onOpenChange(false);
      },
    }),
  );

  const available = credit ? Math.abs(Number(credit.balance.amount)) : 0;

  return (
    <Dialog open={credit !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {credit && (
          <div className="grid gap-6">
            <DialogHeader>
              <DialogTitle>Apply credit from {credit.number}</DialogTitle>
              <DialogDescription>
                {money({ amount: String(available), currency: credit.balance.currency })} of credit.
                Pick the invoice it pays.
              </DialogDescription>
            </DialogHeader>
            {apply.error && (
              <Notice tone="error" title="Couldn't apply the credit">
                {apply.error.message}
              </Notice>
            )}
            {invoices.length === 0 ? (
              <p className="m-0 text-sm text-muted-foreground">
                There are no open invoices to apply it to.
              </p>
            ) : (
              <ul className="m-0 grid list-none divide-y rounded-lg border p-0">
                {invoices.map((i) => {
                  const amount = Math.min(available, Number(i.balance.amount)).toFixed(2);

                  return (
                    <li key={i.invoiceId}>
                      <button
                        type="button"
                        disabled={apply.isPending}
                        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-muted/40"
                        onClick={() =>
                          apply.mutate({
                            creditNoteId: credit.invoiceId,
                            invoiceId: i.invoiceId,
                            amount: { amount, currency: credit.balance.currency },
                            idempotencyKey: key,
                          })
                        }
                      >
                        <span className="font-medium tabular-nums">{i.number}</span>
                        <span className="text-muted-foreground tabular-nums">
                          applies {money({ amount, currency: credit.balance.currency })} of{" "}
                          {money(i.balance)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
