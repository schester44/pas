import type { AdminOutputs } from "@pas/api-client";
import { Panel } from "@pas/ui/components/panel";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@pas/ui/components/sheet";
import { StatusChip, type StatusTone } from "@pas/ui/components/status-chip";
import { formatDate, formatMoney, formatPlainDate } from "@/lib/format";

type Billing = AdminOutputs["policies"]["billing"];
type Invoice = Billing["invoices"][number];

const STATUS: Record<string, { label: string; tone: StatusTone }> = {
  open: { label: "Open", tone: "warning" },
  partially_paid: { label: "Partially paid", tone: "warning" },
  paid: { label: "Paid", tone: "success" },
  void: { label: "Void", tone: "neutral" },
};

const money = (value: { amount: string; currency: string }) =>
  formatMoney(value.amount, value.currency);

const exposureLabel = (exposure: string) => {
  const match = /\[(\d+)\]$/.exec(exposure);

  return match ? `Location ${Number(match[1]) + 1}` : exposure;
};

export function InvoiceStatus({ status }: { status: string }) {
  const { label, tone } = STATUS[status] ?? { label: status, tone: "neutral" as const };

  return <StatusChip tone={tone}>{label}</StatusChip>;
}

/** Invoices, payments and what's still owed on the policy. */
export function BillingPanel({
  billing,
  onOpenInvoice,
}: {
  billing: Billing;
  onOpenInvoice: (invoiceId: string) => void;
}) {
  return (
    <Panel
      title="Billing"
      flush
      action={
        billing.balance && (
          <span className="text-sm text-muted-foreground">
            Balance{" "}
            <span className="font-medium text-foreground tabular-nums">
              {money(billing.balance)}
            </span>
          </span>
        )
      }
    >
      <ul className="m-0 list-none divide-y p-0">
        {billing.invoices.map((invoice) => (
          <li key={invoice.id}>
            <button
              type="button"
              onClick={() => onOpenInvoice(invoice.id)}
              className="flex w-full items-center gap-3 px-(--card-p) py-3 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/40"
            >
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="text-sm font-medium whitespace-nowrap tabular-nums">
                  {invoice.kind === "credit_note" && "Credit note "}
                  {invoice.number}
                </span>
                <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                  Due {formatPlainDate(invoice.dueOn)}
                </span>
              </span>
              <InvoiceStatus status={invoice.status} />
              <span className="text-right text-sm whitespace-nowrap tabular-nums">
                {money(invoice.total)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {billing.payments.length > 0 && (
        <section className="border-t">
          <h3 className="m-0 px-(--card-p) pt-3 pb-1 text-xs font-medium text-muted-foreground">
            Payments
          </h3>
          <ul className="m-0 list-none p-0 pb-2">
            {billing.payments.map((payment) => {
              const method = payment.method as { brand?: string; last4?: string };
              const invoice = billing.invoices.find((i) => i.id === payment.invoiceId);

              return (
                <li key={payment.id} className="flex items-center gap-3 px-(--card-p) py-2 text-sm">
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span>
                      {method.brand} ending {method.last4}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatDate(payment.receivedAt)} · {invoice?.number}
                    </span>
                  </span>
                  <span className="tabular-nums">{money(payment.amount)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </Panel>
  );
}

export function InvoiceSheet({
  invoice,
  onOpenChange,
}: {
  invoice: Invoice | undefined;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={invoice !== undefined} onOpenChange={onOpenChange}>
      <SheetContent>
        {invoice && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-3 tabular-nums">
                {invoice.kind === "credit_note" ? "Credit note" : "Invoice"} {invoice.number}
                <InvoiceStatus status={invoice.status} />
              </SheetTitle>
              <SheetDescription className="tabular-nums">
                {invoice.policyNumber} · issued {formatPlainDate(invoice.issuedOn)} · due{" "}
                {formatPlainDate(invoice.dueOn)}
              </SheetDescription>
            </SheetHeader>
            <SheetBody>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="h-9 text-left text-xs text-muted-foreground">
                    <th className="font-medium">Line</th>
                    <th className="text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.lines.map((line, index) => (
                    <tr key={index} className="h-10 border-t">
                      <td>
                        {line.label}
                        {line.exposure && (
                          <span className="text-muted-foreground">
                            {" "}
                            · {exposureLabel(line.exposure)}
                          </span>
                        )}
                      </td>
                      <td className="text-right tabular-nums">{money(line.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <dl className="m-0 grid gap-1.5 border-t pt-4 text-sm">
                <div className="flex justify-between font-semibold">
                  <dt>Total</dt>
                  <dd className="m-0 tabular-nums">{money(invoice.total)}</dd>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <dt>Paid</dt>
                  <dd className="m-0 tabular-nums">{money(invoice.amountPaid)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Balance</dt>
                  <dd className="m-0 tabular-nums">{money(invoice.balance)}</dd>
                </div>
              </dl>
            </SheetBody>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
