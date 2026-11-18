import { Button } from "@pas/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@pas/ui/components/dialog";
import { Notice } from "@pas/ui/components/notice";
import { Spinner } from "@pas/ui/components/spinner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, Lock } from "lucide-react";
import { useState } from "react";
import {
  type CardDraft,
  CardFields,
  cardInput,
  cardReady,
  EMPTY_CARD,
  TestCardHint,
} from "@/components/card-fields";
import { formatMoney, formatPlainDate } from "@/lib/format";
import type { ClientInvoice } from "@/lib/portal";
import { useTRPC } from "@/lib/trpc";

export function PayDialog({
  invoice,
  onOpenChange,
}: {
  invoice: ClientInvoice | null;
  onOpenChange: (open: boolean) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [card, setCard] = useState<CardDraft>(EMPTY_CARD);
  const [declined, setDeclined] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);
  const pay = useMutation(trpc.client.invoices.pay.mutationOptions());

  const close = (open: boolean) => {
    if (open) return;

    onOpenChange(false);
    setCard(EMPTY_CARD);
    setDeclined(null);
    setPaid(false);
    pay.reset();
  };

  if (!invoice) return null;

  const amount = formatMoney(invoice.balance, { cents: true });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setDeclined(null);

    pay.mutate(
      { id: invoice.id, card: cardInput(card) },
      {
        onSuccess: (result) => {
          if (result.status === "declined") {
            setDeclined(`${result.message} Try another card.`);

            return;
          }

          setPaid(true);
          void queryClient.invalidateQueries({ queryKey: trpc.client.pathKey() });
        },
      },
    );
  };

  return (
    <Dialog open onOpenChange={close}>
      <DialogContent>
        {paid ? (
          <>
            <div className="grid justify-items-center gap-3 py-4 text-center">
              <span className="flex size-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                <CircleCheck className="size-6" />
              </span>
              <DialogTitle>Payment received</DialogTitle>
              <DialogDescription className="tabular-nums">
                {amount} paid toward {invoice.number}. A receipt is on your policy.
              </DialogDescription>
            </div>
            <DialogFooter>
              <Button className="w-full sm:w-auto" onClick={() => close(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} className="grid gap-6">
            <DialogHeader>
              <DialogTitle className="tabular-nums">Pay {amount}</DialogTitle>
              <DialogDescription className="tabular-nums">
                {invoice.number} for policy {invoice.policyNumber}, due{" "}
                {formatPlainDate(invoice.dueOn)}.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4">
              <CardFields card={card} onChange={setCard} compact />
              <TestCardHint />
            </div>
            {(declined || pay.error) && (
              <Notice
                tone="error"
                title={declined ? "Payment declined" : "Couldn't take the payment"}
              >
                {declined ?? pay.error?.message}
              </Notice>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!cardReady(card) || pay.isPending}>
                {pay.isPending ? <Spinner /> : <Lock />}
                Pay {amount}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
