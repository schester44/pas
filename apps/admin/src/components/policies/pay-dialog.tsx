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
import { formatMoney } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";
import type { Invoice } from "./billing";

const digits = (value: string) => value.replace(/\D/g, "");

/** Takes a card payment for one invoice (e.g. by phone). */
export function PayDialog({
  policyId,
  invoice,
  onOpenChange,
}: {
  policyId: string;
  invoice: Invoice | null;
  onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [card, setCard] = useState({ number: "", expiry: "", cvc: "", name: "" });
  const [declined, setDeclined] = useState<string | null>(null);

  const pay = useMutation(
    trpc.policies.payInvoice.mutationOptions({
      onSuccess: async (result) => {
        if (result.status === "declined") {
          setDeclined(result.message);

          return;
        }

        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: trpc.policies.billing.queryKey({ id: policyId }),
          }),
          queryClient.invalidateQueries({ queryKey: trpc.policies.get.queryKey({ id: policyId }) }),
        ]);

        onOpenChange(false);
      },
    }),
  );

  const expiry = digits(card.expiry);

  const ready =
    digits(card.number).length >= 13 &&
    expiry.length === 4 &&
    /^\d{3,4}$/.test(card.cvc) &&
    card.name.trim();

  return (
    <Dialog open={invoice !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {invoice && (
          <form
            className="grid gap-6"
            onSubmit={(event) => {
              event.preventDefault();
              setDeclined(null);

              pay.mutate({
                policyId,
                invoiceId: invoice.id,
                card: {
                  number: digits(card.number),
                  expMonth: Number(expiry.slice(0, 2)),
                  expYear: 2000 + Number(expiry.slice(2)),
                  cvc: card.cvc,
                  name: card.name.trim(),
                },
              });
            }}
          >
            <DialogHeader>
              <DialogTitle>Pay {formatMoney(invoice.balance)}</DialogTitle>
              <DialogDescription className="tabular-nums">{invoice.number}</DialogDescription>
            </DialogHeader>
            {(declined ?? pay.error?.message) && (
              <Notice tone="error" title="Couldn't take the payment">
                {declined ?? pay.error?.message}
              </Notice>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 grid gap-2">
                <Label htmlFor={`${id}-number`}>Card number</Label>
                <Input
                  id={`${id}-number`}
                  inputMode="numeric"
                  autoComplete="cc-number"
                  className="tabular-nums"
                  value={card.number}
                  onChange={(e) => setCard({ ...card, number: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`${id}-expiry`}>Expiry</Label>
                <Input
                  id={`${id}-expiry`}
                  placeholder="MM / YY"
                  inputMode="numeric"
                  className="tabular-nums"
                  value={card.expiry}
                  onChange={(e) => setCard({ ...card, expiry: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`${id}-cvc`}>Security code</Label>
                <Input
                  id={`${id}-cvc`}
                  inputMode="numeric"
                  className="tabular-nums"
                  value={card.cvc}
                  onChange={(e) => setCard({ ...card, cvc: e.target.value })}
                />
              </div>
              <div className="col-span-2 grid gap-2">
                <Label htmlFor={`${id}-name`}>Name on card</Label>
                <Input
                  id={`${id}-name`}
                  autoComplete="cc-name"
                  value={card.name}
                  onChange={(e) => setCard({ ...card, name: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={!ready || pay.isPending}>
                {pay.isPending && <Spinner />} Pay {formatMoney(invoice.balance)}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
