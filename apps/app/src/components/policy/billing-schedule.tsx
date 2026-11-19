import type { AppOutputs } from "@pas/api-client";
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
import { Notice } from "@pas/ui/components/notice";
import { Panel } from "@pas/ui/components/panel";
import { Spinner } from "@pas/ui/components/spinner";
import { StatusChip } from "@pas/ui/components/status-chip";
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
import { invoiceStatus, isDue } from "@/lib/portal";

export type PolicyBilling = AppOutputs["policies"]["billing"];
type Invoice = PolicyBilling["invoices"][number];

type CardValue = ReturnType<typeof cardInput>;

export type AutopayChange = (input: {
  enabled: boolean;
  card?: CardValue;
}) => Promise<{ status: "updated" } | { status: "declined"; message: string }>;

/** The installment schedule (upcoming, paid, past due), autopay and pay now. */
export function BillingSchedule({
  billing,
  onPay,
  onAutopay,
}: {
  billing: PolicyBilling;
  onPay: (invoice: Invoice) => void;
  onAutopay?: AutopayChange;
}) {
  const [autopayOpen, setAutopayOpen] = useState(false);
  const schedule = billing.schedule;

  const installments = billing.invoices
    .filter((i) => i.scheduleId && i.kind === "invoice")
    .toSorted((a, b) => a.installment - b.installment);

  const others = billing.invoices.filter((i) => !installments.includes(i));
  const pastDue = billing.pastDue && Number(billing.pastDue.amount) > 0 ? billing.pastDue : null;
  const hasInstallments = (schedule?.plan.installments ?? 1) > 1;

  return (
    <Panel
      title="Billing"
      description={schedule?.plan.label}
      flush
      footer={
        hasInstallments &&
        schedule?.status === "active" && (
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground tabular-nums">
              {schedule.autopay
                ? `Autopay on · ${schedule.autopay.brand} ending ${schedule.autopay.last4}`
                : "Autopay off"}
            </span>
            {onAutopay &&
              (schedule.autopay ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void onAutopay({ enabled: false })}
                >
                  Turn off
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setAutopayOpen(true)}>
                  Turn on autopay
                </Button>
              ))}
          </div>
        )
      }
    >
      {(pastDue || billing.nextDue) && (
        <div className="flex items-center justify-between gap-3 border-b px-(--card-p) py-3">
          <div className="grid gap-0.5">
            <span className="text-xs text-muted-foreground">
              {pastDue ? "Past due" : "Next payment"}
            </span>
            <span
              className={
                pastDue
                  ? "text-lg font-semibold text-red-700 tabular-nums"
                  : "text-lg font-semibold tabular-nums"
              }
            >
              {formatMoney(pastDue ?? billing.nextDue!.amount, { cents: true })}
            </span>
            {!pastDue && billing.nextDue && (
              <span className="text-xs text-muted-foreground tabular-nums">
                Due {formatPlainDate(billing.nextDue.dueOn)}
                {schedule?.autopay && " · paid automatically"}
              </span>
            )}
          </div>
          {billing.nextDue && (
            <Button
              size="sm"
              onClick={() => {
                const next = billing.invoices.find((i) => i.id === billing.nextDue!.invoiceId);

                if (next) onPay(next);
              }}
            >
              Pay now
            </Button>
          )}
        </div>
      )}
      {billing.invoices.length === 0 ? (
        <EmptyState title="No bills yet" />
      ) : (
        <>
          {installments.length > 0 && <Rows invoices={installments} onPay={onPay} />}
          {others.length > 0 && (
            <>
              {installments.length > 0 && (
                <h3 className="m-0 border-t px-(--card-p) pt-3 pb-1 text-xs font-medium text-muted-foreground">
                  Other bills
                </h3>
              )}
              <Rows invoices={others} onPay={onPay} />
            </>
          )}
        </>
      )}
      {onAutopay && (
        <AutopayDialog open={autopayOpen} onOpenChange={setAutopayOpen} onAutopay={onAutopay} />
      )}
    </Panel>
  );
}

function Rows({ invoices, onPay }: { invoices: Invoice[]; onPay: (invoice: Invoice) => void }) {
  return (
    <ul className="m-0 list-none divide-y p-0">
      {invoices.map((invoice) => {
        const status = invoiceStatus(invoice.status, invoice.kind);
        const due = isDue(invoice);

        return (
          <li key={invoice.id} className="flex items-center gap-3 px-(--card-p) py-3">
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="text-sm font-medium whitespace-nowrap tabular-nums">
                {invoice.installments > 1
                  ? `${invoice.installment} of ${invoice.installments}`
                  : invoice.kind === "credit_note"
                    ? "Credit note"
                    : invoice.number}
              </span>
              <span className="truncate text-xs text-muted-foreground tabular-nums">
                {invoice.kind === "invoice"
                  ? `Due ${formatPlainDate(invoice.dueOn)}`
                  : invoice.number}
              </span>
            </span>
            <StatusChip tone={status.tone}>{status.label}</StatusChip>
            <span className="text-right text-sm whitespace-nowrap tabular-nums">
              {formatMoney(due ? invoice.balance : invoice.total, { cents: true })}
            </span>
            {due && (
              <Button size="sm" variant="outline" onClick={() => onPay(invoice)}>
                Pay
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function AutopayDialog({
  open,
  onOpenChange,
  onAutopay,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAutopay: AutopayChange;
}) {
  const [card, setCard] = useState<CardDraft>(EMPTY_CARD);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="grid gap-6"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError(null);

            try {
              const result = await onAutopay({ enabled: true, card: cardInput(card) });

              if (result.status === "declined") setError(result.message);
              else onOpenChange(false);
            } catch (failure) {
              setError((failure as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Turn on autopay</DialogTitle>
            <DialogDescription>
              Each installment is charged to this card on its due date until the policy is paid in
              full or you turn autopay off.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <CardFields card={card} onChange={setCard} compact />
            <TestCardHint />
          </div>
          {error && (
            <Notice tone="error" title="Couldn't save the card">
              {error}
            </Notice>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!cardReady(card) || busy}>
              {busy && <Spinner />} Turn on autopay
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
