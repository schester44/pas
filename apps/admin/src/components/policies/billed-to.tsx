import { Button } from "@pas/ui/components/button";
import { Notice } from "@pas/ui/components/notice";
import { Panel } from "@pas/ui/components/panel";
import { Spinner } from "@pas/ui/components/spinner";
import { StatusChip, type StatusTone } from "@pas/ui/components/status-chip";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  SimulateBillingEvent,
  type SimulationTarget,
  useSimulation,
} from "@/components/billing/simulate-billing-event";
import { RecordPaymentDialog } from "@/components/ledger/record-payment-dialog";
import { useLedgerOverview } from "@/components/ledger/shared";
import { formatPlainDate } from "@/lib/format";
import { useAccess } from "@/lib/permissions";
import { useTRPC } from "@/lib/trpc";
import { isPayable } from "./billing";
import { type Billing, money } from "./policy-format";

const METHOD: Record<string, string> = {
  direct: "Direct bill",
  agency: "Agency bill",
  mortgagee: "Mortgagee bill",
};

const MORTGAGEE: Record<string, { label: string; tone: StatusTone }> = {
  awaiting_packet: { label: "Sending packet", tone: "neutral" },
  awaiting_payment: { label: "Awaiting lender", tone: "warning" },
  paid: { label: "Paid by lender", tone: "success" },
  switched_to_direct: { label: "Switched to direct", tone: "neutral" },
  nonpayment: { label: "Nonpayment", tone: "danger" },
};

const STATEMENT: Record<string, { label: string; tone: StatusTone }> = {
  open: { label: "On statement", tone: "neutral" },
  partially_paid: { label: "Partially paid", tone: "warning" },
  paid: { label: "Paid", tone: "success" },
  past_due: { label: "Past due", tone: "danger" },
  credit: { label: "Credit", tone: "neutral" },
};

const HISTORY: Record<string, string> = {
  packet_sent: "Invoice mailed",
  reminder_sent: "Reminder sent",
  insured_offered_direct: "Insured offered direct bill",
  switched_to_direct: "Switched to direct",
  nonpayment_started: "Nonpayment started",
  paid: "Paid",
  lender_changed: "Lender changed",
};

const NEXT: Record<string, string> = {
  remind_lender: "Next reminder",
  offer_direct: "Insured offered direct bill",
  nonpayment: "Nonpayment starts",
};

const shortDate = (iso: string) =>
  Temporal.PlainDate.from(iso).toLocaleString("en-US", { month: "short", day: "numeric" });

/** Who the term is billed to and where that bill stands (PLAN §13). */
export function BilledTo({ policyId, billing }: { policyId: string; billing: Billing }) {
  const trpc = useTRPC();
  const access = useAccess();
  const queryClient = useQueryClient();
  const simulation = useSimulation();
  const navigate = useNavigate();
  const native = useLedgerOverview().data?.native === true && access.billing.write;
  const [target, setTarget] = useState<SimulationTarget | null>(null);
  const [recording, setRecording] = useState(false);
  const schedule = billing.schedule;
  const mortgagee = billing.mortgagee;
  const statement = billing.statements.at(-1);
  const method = schedule?.billingMethod ?? "direct";

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.policies.billing.queryKey({ id: policyId }) }),
      queryClient.invalidateQueries({ queryKey: trpc.policies.get.queryKey({ id: policyId }) }),
    ]);

  const switchToDirect = useMutation(
    trpc.policies.switchToDirect.mutationOptions({ onSuccess: refresh }),
  );

  const payable = billing.invoices.find((i) => isPayable(i) && i.status !== "scheduled");

  const payer =
    method === "mortgagee" && mortgagee
      ? `${mortgagee.lender.name}${mortgagee.lender.loanNumber ? ` · Loan ${mortgagee.lender.loanNumber}` : ""}`
      : method === "agency"
        ? (schedule?.payer.name ?? "The agency")
        : "the insured";

  const switched = mortgagee?.history.some((h) => h.kind === "switched_to_direct")
    ? mortgagee
    : null;

  const trail = switched
    ? switched.history
        .filter((h) => h.kind === "packet_sent" || h.kind === "switched_to_direct")
        .map((h) =>
          h.kind === "packet_sent"
            ? `${switched.lender.name} invoiced ${shortDate(h.on)}`
            : `Switched to direct ${shortDate(h.on)}`,
        )
    : method === "mortgagee" && mortgagee
      ? [
          ...mortgagee.history.map((h) => `${HISTORY[h.kind] ?? h.kind} ${shortDate(h.on)}`),
          ...(mortgagee.next
            ? [`${NEXT[mortgagee.next.action]} ${shortDate(mortgagee.next.on)}`]
            : []),
        ]
      : method === "agency" && statement
        ? [`On account current ${statement.number}`, `Due ${formatPlainDate(statement.dueOn)}`]
        : method === "agency"
          ? ["On the next account current"]
          : [];

  const chip = switched
    ? MORTGAGEE.switched_to_direct
    : method === "mortgagee" && mortgagee
      ? MORTGAGEE[mortgagee.status]
      : method === "agency" && statement
        ? payable
          ? STATEMENT[statement.status]
          : { label: "Paid", tone: "success" as const }
        : null;

  if (method === "direct" && !mortgagee && !simulation && !native) return null;

  return (
    <Panel
      title={METHOD[method] ?? method}
      description={
        <span className="tabular-nums">
          Billed to {payer}
          {trail.length > 0 && ` · ${trail.join(" · ")}`}
        </span>
      }
      action={
        <div className="flex items-center gap-2">
          {chip && <StatusChip tone={chip.tone}>{chip.label}</StatusChip>}
          {method === "agency" && statement && (
            <Button size="sm" variant="outline" asChild>
              <Link
                to="/billing/statements/$statementId"
                params={{ statementId: statement.statementId }}
              >
                Open statement
              </Link>
            </Button>
          )}
          {mortgagee?.canSwitchToDirect && access.policies.update && (
            <Button
              size="sm"
              variant="outline"
              disabled={switchToDirect.isPending}
              onClick={() => switchToDirect.mutate({ policyId })}
            >
              {switchToDirect.isPending && <Spinner />}
              Switch to direct bill
            </Button>
          )}
          {simulation && payable && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setTarget({
                  invoiceId: payable.id,
                  label: payable.number,
                  balance: payable.balance,
                })
              }
            >
              Simulate billing event
            </Button>
          )}
          {native && payable && (
            <Button size="sm" variant="ghost" onClick={() => setRecording(true)}>
              Record payment
            </Button>
          )}
        </div>
      }
    >
      {switchToDirect.error ? (
        <Notice tone="error" title="Couldn't switch to direct bill">
          {switchToDirect.error.message}
        </Notice>
      ) : mortgagee?.canSwitchToDirect && payable ? (
        <p className="m-0 text-sm text-muted-foreground tabular-nums">
          {money(payable.balance)} on {payable.number} is due from the lender by{" "}
          {formatPlainDate(payable.dueOn)}. Switching re-issues it to the insured with a pay link.
        </p>
      ) : (
        <p className="m-0 text-sm text-muted-foreground">
          {method === "agency"
            ? "The agency remits on its monthly account current; payments arrive from the billing system."
            : method === "mortgagee"
              ? "The lender's payment arrives from the billing system."
              : "The insured pays online, or the billing system reports payments."}
        </p>
      )}
      <RecordPaymentDialog
        open={recording}
        onOpenChange={setRecording}
        onRecorded={(paymentId) => {
          setRecording(false);
          void navigate({ to: "/billing/apply", search: { paymentId } });
        }}
      />
      <SimulateBillingEvent
        target={target}
        onOpenChange={(open) => !open && setTarget(null)}
        onApplied={refresh}
      />
    </Panel>
  );
}
