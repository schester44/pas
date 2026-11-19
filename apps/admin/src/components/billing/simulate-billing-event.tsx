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
import { useMutation, useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useAccess } from "@/lib/permissions";
import { useTRPC } from "@/lib/trpc";

type EventType = "payment.received" | "payment.reversed";

export interface SimulationTarget {
  invoiceId?: string;
  statementId?: string;
  label: string;
  balance: { amount: string; currency: string };
}

/** Whether staff may post simulated billing events here (built-in billing or a sandbox). */
export function useSimulation() {
  const trpc = useTRPC();
  const access = useAccess();

  const simulation = useQuery({
    ...trpc.billing.simulation.queryOptions(),
    enabled: access.billing.write,
  });

  return access.billing.write && simulation.data?.available === true;
}

/**
 * Posts a billing event as the billing system would (PLAN §13 "Bring your own billing"), through
 * the same application path. Clearly a simulation: for the built-in billing and sandboxes only.
 */
export function SimulateBillingEvent({
  target,
  onOpenChange,
  onApplied,
}: {
  target: SimulationTarget | null;
  onOpenChange: (open: boolean) => void;
  onApplied: () => Promise<unknown> | void;
}) {
  const id = useId();
  const trpc = useTRPC();
  const [type, setType] = useState<EventType>("payment.received");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");

  const simulate = useMutation(
    trpc.billing.simulate.mutationOptions({
      onSuccess: async () => {
        await onApplied();
        onOpenChange(false);
      },
    }),
  );

  const valid = /^\d+(\.\d{1,2})?$/.test(amount.trim()) && Number(amount) > 0;

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (open) return;

        setAmount("");
        setReference("");
        simulate.reset();
        onOpenChange(false);
      }}
    >
      <DialogContent>
        {target && (
          <form
            className="grid gap-6"
            onSubmit={(event) => {
              event.preventDefault();

              simulate.mutate({
                ...(target.invoiceId && { invoiceId: target.invoiceId }),
                ...(target.statementId && { statementId: target.statementId }),
                type,
                amount: { amount: amount.trim(), currency: target.balance.currency },
                ...(reference.trim() && { reference: reference.trim() }),
              });
            }}
          >
            <DialogHeader>
              <DialogTitle>Simulate billing event</DialogTitle>
              <DialogDescription>
                Posts what the billing system would send for {target.label}. Simulation only: no
                money moves.
              </DialogDescription>
            </DialogHeader>
            {simulate.error && (
              <Notice tone="error" title="Couldn't apply the event">
                {simulate.error.message}
              </Notice>
            )}
            <div className="grid gap-4">
              <SegmentedControl
                label="Event"
                value={type}
                onValueChange={setType}
                options={[
                  { value: "payment.received", label: "Payment received" },
                  { value: "payment.reversed", label: "Payment reversed" },
                ]}
              />
              <div className="grid gap-2">
                <Label htmlFor={`${id}-amount`}>Amount</Label>
                <Input
                  id={`${id}-amount`}
                  inputMode="decimal"
                  className="tabular-nums"
                  placeholder={target.balance.amount}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`${id}-reference`}>
                  Reference <span className="font-normal text-muted-foreground">optional</span>
                </Label>
                <Input
                  id={`${id}-reference`}
                  placeholder="Check 10482"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!valid || simulate.isPending}>
                {simulate.isPending && <Spinner />}
                Post simulated event
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
