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
import { Spinner } from "@pas/ui/components/spinner";
import { cn } from "@pas/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useTRPC } from "@/lib/trpc";
import { Amount, PAYER_LABEL, useIdempotencyKey, useLedgerOverview, validAmount } from "./shared";

type OfflineRail = "check" | "wire" | "ach_push";

export interface Payer {
  type: "insured" | "agency" | "mortgagee";
  ref: string | null;
  name: string | null;
}

/** Finance records a check, wire or ACH push; it lands in unapplied cash until it's applied. */
export function RecordPaymentDialog({
  open,
  onOpenChange,
  onRecorded,
  initialPayer = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRecorded: (paymentId: string) => void;
  initialPayer?: Payer | null;
}) {
  const id = useId();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const overview = useLedgerOverview();
  const [key, renewKey] = useIdempotencyKey();
  const [rail, setRail] = useState<OfflineRail>("check");
  const [search, setSearch] = useState("");
  const [payer, setPayer] = useState<Payer | null>(initialPayer);
  const [amount, setAmount] = useState("");
  const [receivedOn, setReceivedOn] = useState("");
  const [reference, setReference] = useState("");
  const [memo, setMemo] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const payers = useQuery({
    ...trpc.ledger.payers.queryOptions({ search: search.trim() }),
    enabled: open && search.trim().length > 1 && !payer,
  });

  const record = useMutation(
    trpc.ledger.recordPayment.mutationOptions({
      onSuccess: async (result) => {
        await queryClient.invalidateQueries({ queryKey: trpc.ledger.pathKey() });
        reset();
        onRecorded(result.paymentId);
      },
    }),
  );

  const reset = () => {
    setRail("check");
    setSearch("");
    setPayer(initialPayer);
    setAmount("");
    setReceivedOn("");
    setReference("");
    setMemo("");
    setSubmitted(false);
    record.reset();
    renewKey();
  };

  const currency = overview.data?.currency ?? "USD";
  const date = receivedOn || overview.data?.today || "";
  const amountOk = validAmount(amount);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();

        onOpenChange(next);
      }}
    >
      <DialogContent>
        <form
          className="grid gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted(true);

            if (!amountOk || !date) return;

            record.mutate({
              rail,
              payer,
              amount: { amount: amount.trim(), currency },
              receivedOn: date,
              reference: reference.trim()
                ? `${rail === "check" ? "Check " : ""}${reference.trim()}`
                : null,
              memo: memo.trim() || null,
              idempotencyKey: key,
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>Record payment</DialogTitle>
            <DialogDescription>Checks go into today's deposit batch.</DialogDescription>
          </DialogHeader>
          {record.error && (
            <Notice tone="error" title="Couldn't record the payment">
              {record.error.message}
            </Notice>
          )}
          <div className="grid gap-4">
            <SegmentedControl
              label="Received by"
              value={rail}
              onValueChange={setRail}
              options={[
                { value: "check", label: "Check" },
                { value: "wire", label: "Wire" },
                { value: "ach_push", label: "ACH push" },
              ]}
            />
            <div className="grid gap-2">
              <Label htmlFor={`${id}-payer`}>
                Payer <span className="font-normal text-muted-foreground">optional</span>
              </Label>
              {payer ? (
                <div className="flex h-9 items-center justify-between rounded-md border px-3 text-sm">
                  <span className="truncate">
                    {payer.name ?? payer.ref}
                    <span className="text-muted-foreground"> · {PAYER_LABEL[payer.type]}</span>
                  </span>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setPayer(null)}>
                    Change
                  </Button>
                </div>
              ) : (
                <>
                  <Input
                    id={`${id}-payer`}
                    placeholder="Agency, lender, insured, policy or invoice number"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {(payers.data?.length ?? 0) > 0 && (
                    <ul className="m-0 grid max-h-48 list-none overflow-y-auto rounded-md border p-1">
                      {payers.data!.map((p) => (
                        <li key={`${p.payerType}:${p.payerRef ?? p.payerName}`}>
                          <button
                            type="button"
                            className="flex w-full items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
                            onClick={() =>
                              setPayer({
                                type: p.payerType as Payer["type"],
                                ref: p.payerRef,
                                name: p.payerName,
                              })
                            }
                          >
                            <span className="truncate">
                              {p.payerName}
                              <span className="text-muted-foreground">
                                {" "}
                                · {PAYER_LABEL[p.payerType]}
                              </span>
                            </span>
                            <Amount value={p.balance} className="text-muted-foreground" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor={`${id}-amount`}>Amount</Label>
                <Input
                  id={`${id}-amount`}
                  inputMode="decimal"
                  className="tabular-nums"
                  placeholder="0.00"
                  aria-invalid={submitted && !amountOk}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                {submitted && !amountOk && (
                  <p className="m-0 text-xs text-destructive">Enter an amount like 125.00</p>
                )}
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`${id}-date`}>Received on</Label>
                <Input
                  id={`${id}-date`}
                  type="date"
                  className="tabular-nums"
                  value={date}
                  onChange={(e) => setReceivedOn(e.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-reference`}>
                {rail === "check" ? "Check number" : "Reference"}{" "}
                <span className="font-normal text-muted-foreground">optional</span>
              </Label>
              <Input
                id={`${id}-reference`}
                className={cn(rail === "check" && "tabular-nums")}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-memo`}>
                Memo <span className="font-normal text-muted-foreground">optional</span>
              </Label>
              <Input id={`${id}-memo`} value={memo} onChange={(e) => setMemo(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={record.isPending}>
              {record.isPending && <Spinner />}
              Record payment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
