import { Button } from "@pas/ui/components/button";
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { SegmentedControl } from "@pas/ui/components/segmented-control";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { PaymentSheet } from "@/components/ledger/payment-sheet";
import {
  BatchesTable,
  LockboxPanel,
  PaymentsTable,
  RefundsTable,
  WriteOffsPanel,
} from "@/components/ledger/payments-lists";
import { RecordPaymentDialog } from "@/components/ledger/record-payment-dialog";
import { ExternalBillingNotice, useLedgerOverview } from "@/components/ledger/shared";
import { useAccess } from "@/lib/permissions";

const TABS = ["payments", "deposits", "lockbox", "refunds", "write_offs"] as const;

type Tab = (typeof TABS)[number];

export const Route = createFileRoute("/_authed/billing/payments")({
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } =>
    TABS.includes(search.tab as Tab) ? { tab: search.tab as Tab } : {},
  component: PaymentsPage,
});

function PaymentsPage() {
  const { tab = "payments" } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const access = useAccess();
  const overview = useLedgerOverview();
  const [recording, setRecording] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const native = overview.data?.native !== false;

  return (
    <>
      <PageHeader
        title="Payments"
        actions={
          native &&
          access.billing.write && (
            <Button onClick={() => setRecording(true)}>
              <Plus />
              Record payment
            </Button>
          )
        }
      />
      <PageBody className="max-w-6xl">
        {!native && <ExternalBillingNotice />}
        <SegmentedControl
          label="Payments views"
          className="self-start"
          value={tab}
          onValueChange={(next) => navigate({ search: next === "payments" ? {} : { tab: next } })}
          options={[
            { value: "payments", label: "Payments" },
            { value: "deposits", label: "Deposits" },
            { value: "lockbox", label: "Lockbox" },
            { value: "refunds", label: "Refunds" },
            { value: "write_offs", label: "Write-offs" },
          ]}
        />
        {tab === "payments" && <PaymentsTable onOpen={setOpen} />}
        {tab === "deposits" && <BatchesTable />}
        {tab === "lockbox" && <LockboxPanel />}
        {tab === "refunds" && <RefundsTable />}
        {tab === "write_offs" && <WriteOffsPanel />}
      </PageBody>
      <RecordPaymentDialog
        open={recording}
        onOpenChange={setRecording}
        onRecorded={(paymentId) => {
          setRecording(false);
          void navigate({ to: "/billing/apply", search: { paymentId } });
        }}
      />
      <PaymentSheet paymentId={open} onOpenChange={(next) => !next && setOpen(null)} />
    </>
  );
}
