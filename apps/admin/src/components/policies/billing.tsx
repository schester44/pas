import type { AdminOutputs } from "@pas/api-client";
import { Button } from "@pas/ui/components/button";
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
import { exposureLabel } from "@pas/ui/lib/policy-change";

type Billing = AdminOutputs["policies"]["billing"];
export type Invoice = Billing["invoices"][number];

const STATUS: Record<string, { label: string; tone: StatusTone }> = {
  scheduled: { label: "Scheduled", tone: "neutral" },
  open: { label: "Open", tone: "warning" },
  past_due: { label: "Past due", tone: "danger" },
  partially_paid: { label: "Partially paid", tone: "warning" },
  paid: { label: "Paid", tone: "success" },
  void: { label: "Void", tone: "neutral" },
};

const CREDIT_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  open: { label: "Credit", tone: "neutral" },
  partially_paid: { label: "Part applied", tone: "neutral" },
  paid: { label: "Settled", tone: "success" },
};

const PAYABLE = new Set(["open", "past_due", "partially_paid", "scheduled"]);

export const isPayable = (invoice: Invoice) =>
  invoice.kind === "invoice" && PAYABLE.has(invoice.status) && Number(invoice.balance.amount) > 0;

export function InvoiceStatus({ status, kind }: { status: string; kind?: string }) {
  const { label, tone } = (kind === "credit_note" ? CREDIT_STATUS[status] : undefined) ??
    STATUS[status] ?? { label: status, tone: "neutral" as const };

  return <StatusChip tone={tone}>{label}</StatusChip>;
}

const planSummary = (schedule: NonNullable<Billing["schedule"]>) =>
  schedule.plan.installments <= 1
    ? schedule.plan.label
    : `${schedule.plan.label} · ${schedule.plan.installments} installments`;

/** The installment schedule, autopay, other bills and payments for the policy. */
export function BillingPanel({
  billing,
  onOpenInvoice,
  onPay,
}: {
  billing: Billing;
  onOpenInvoice: (invoiceId: string) => void;
  onPay?: (invoice: Invoice) => void;
}) {
  const installments = billing.invoices
    .filter((i) => i.scheduleId && i.kind === "invoice")
    .toSorted((a, b) => a.installment - b.installment);

  const others = billing.invoices.filter((i) => !installments.includes(i));
  const schedule = billing.schedule;

  return (
    <Panel
      title="Billing"
      description={
        schedule && (
          <span className="tabular-nums">
            {planSummary(schedule)}
            {schedule.plan.installments > 1 &&
              (schedule.autopay
                ? ` · Autopay ${schedule.autopay.brand} ${schedule.autopay.last4}`
                : " · Autopay off")}
          </span>
        )
      }
      flush
      action={
        billing.balance && (
          <span className="text-sm text-muted-foreground">
            Due now{" "}
            <span className="font-medium text-foreground tabular-nums">
              {formatMoney(billing.balance)}
            </span>
          </span>
        )
      }
    >
      {installments.length > 0 && (
        <InvoiceList
          heading={installments.length > 1 ? "Schedule" : undefined}
          invoices={installments}
          onOpenInvoice={onOpenInvoice}
          onPay={onPay}
        />
      )}
      {others.length > 0 && (
        <InvoiceList
          heading={installments.length > 0 ? "Other bills" : undefined}
          invoices={others}
          onOpenInvoice={onOpenInvoice}
          onPay={onPay}
        />
      )}
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
                      {payment.kind === "refund"
                        ? "Refund to "
                        : payment.kind === "reversal"
                          ? "Reversed: "
                          : ""}
                      {method.last4 ? `${method.brand} ending ${method.last4}` : payment.provider}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatDate(payment.receivedAt)} · {invoice?.number}
                    </span>
                  </span>
                  <span className="tabular-nums">{formatMoney(payment.amount)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </Panel>
  );
}

function InvoiceList({
  heading,
  invoices,
  onOpenInvoice,
  onPay,
}: {
  heading?: string;
  invoices: Invoice[];
  onOpenInvoice: (invoiceId: string) => void;
  onPay?: (invoice: Invoice) => void;
}) {
  return (
    <section className="border-t first:border-t-0">
      {heading && (
        <h3 className="m-0 px-(--card-p) pt-3 pb-1 text-xs font-medium text-muted-foreground">
          {heading}
        </h3>
      )}
      <ul className="m-0 list-none divide-y p-0">
        {invoices.map((invoice) => (
          <li key={invoice.id} className="flex items-center gap-2 pr-(--card-p)">
            <button
              type="button"
              onClick={() => onOpenInvoice(invoice.id)}
              className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-(--card-p) text-left outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/40"
            >
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="text-sm font-medium whitespace-nowrap tabular-nums">
                  {invoice.installments > 1
                    ? `${invoice.installment} of ${invoice.installments}`
                    : invoice.number}
                </span>
                <span className="truncate text-xs text-muted-foreground tabular-nums">
                  {invoice.kind === "credit_note"
                    ? `Credit note ${invoice.number}`
                    : `Due ${formatPlainDate(invoice.dueOn)}`}
                </span>
              </span>
              <InvoiceStatus status={invoice.status} kind={invoice.kind} />
              <span className="text-right text-sm whitespace-nowrap tabular-nums">
                {formatMoney(invoice.total)}
              </span>
            </button>
            {onPay && isPayable(invoice) && invoice.status !== "scheduled" && (
              <Button size="sm" variant="outline" onClick={() => onPay(invoice)}>
                Pay
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function InvoiceSheet({
  invoice,
  onOpenChange,
  labels,
}: {
  invoice: Invoice | undefined;
  onOpenChange: (open: boolean) => void;
  labels?: Record<string, string>;
}) {
  return (
    <Sheet open={invoice !== undefined} onOpenChange={onOpenChange}>
      <SheetContent>
        {invoice && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-3 tabular-nums">
                {invoice.kind === "credit_note" ? "Credit note" : "Invoice"} {invoice.number}
                <InvoiceStatus status={invoice.status} kind={invoice.kind} />
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
                            · {exposureLabel(line.exposure, labels) ?? line.exposure}
                          </span>
                        )}
                      </td>
                      <td className="text-right tabular-nums">{formatMoney(line.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <dl className="m-0 grid gap-1.5 border-t pt-4 text-sm">
                <div className="flex justify-between font-semibold">
                  <dt>Total</dt>
                  <dd className="m-0 tabular-nums">{formatMoney(invoice.total)}</dd>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <dt>Paid</dt>
                  <dd className="m-0 tabular-nums">{formatMoney(invoice.amountPaid)}</dd>
                </div>
                {Number(invoice.amountCredited.amount) !== 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <dt>Credited</dt>
                    <dd className="m-0 tabular-nums">{formatMoney(invoice.amountCredited)}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt>Balance</dt>
                  <dd className="m-0 tabular-nums">{formatMoney(invoice.balance)}</dd>
                </div>
              </dl>
            </SheetBody>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
