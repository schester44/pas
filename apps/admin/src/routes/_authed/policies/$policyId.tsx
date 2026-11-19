import { Notice } from "@pas/ui/components/notice";
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Breadcrumb } from "@/components/catalog/breadcrumb";
import { ActivityTimeline } from "@/components/policies/activity";
import { BilledTo } from "@/components/policies/billed-to";
import { BillingPanel, type Invoice, InvoiceSheet } from "@/components/policies/billing";
import { PolicyCoverage } from "@/components/policies/coverage";
import { PolicyDocuments } from "@/components/policies/documents";
import { PolicyOverview } from "@/components/policies/overview";
import { ProducerOfRecord } from "@/components/policies/producer-of-record";
import { PayDialog } from "@/components/policies/pay-dialog";
import type { Billing, Policy } from "@/components/policies/policy-format";
import { PolicySummary } from "@/components/policies/policy-summary";
import { isPolicyTab, type PolicyTab, PolicyTabs } from "@/components/policies/policy-tabs";
import { PolicyTransactions } from "@/components/policies/transactions";
import { useTRPC } from "@/lib/trpc";

interface PolicySearch {
  tab?: Exclude<PolicyTab, "overview">;
  invoice?: string;
}

export const Route = createFileRoute("/_authed/policies/$policyId")({
  validateSearch: (search: Record<string, unknown>): PolicySearch => ({
    ...(isPolicyTab(search.tab) && search.tab !== "overview" && { tab: search.tab }),
    ...(typeof search.invoice === "string" && search.invoice && { invoice: search.invoice }),
  }),
  component: PolicyPage,
});

function PolicyPage() {
  const { policyId } = Route.useParams();
  const { tab = "overview", invoice: invoiceId } = Route.useSearch();
  const navigate = Route.useNavigate();
  const trpc = useTRPC();
  const policy = useQuery(trpc.policies.get.queryOptions({ id: policyId }));
  const billing = useQuery(trpc.policies.billing.queryOptions({ id: policyId }));
  const [paying, setPaying] = useState<Invoice | null>(null);

  const openInvoice = (id: string | undefined) =>
    navigate({ search: (prev) => ({ ...prev, invoice: id }), resetScroll: false });

  return (
    <>
      <PageHeader
        title={
          <Breadcrumb
            parents={[
              <Link key="policies" to="/policies">
                Policies
              </Link>,
            ]}
            current={policy.data && <span className="tabular-nums">{policy.data.number}</span>}
          />
        }
      />
      <PageBody className="max-w-6xl">
        {policy.error ? (
          <Notice tone="error" title="Couldn't load this policy">
            {policy.error.message}
          </Notice>
        ) : !policy.data ? (
          <>
            <div className="h-44 animate-pulse rounded-xl bg-muted/60" />
            <div className="h-96 animate-pulse rounded-xl bg-muted/60" />
          </>
        ) : (
          <>
            <PolicySummary policy={policy.data} billing={billing.data} />
            <div className="grid gap-6">
              <PolicyTabs
                policyId={policy.data.id}
                current={tab}
                counts={{
                  documents: policy.data.documents.length,
                  transactions: policy.data.transactions.length,
                }}
              />
              <TabContent
                tab={tab}
                policy={policy.data}
                billing={billing.data}
                onOpenInvoice={openInvoice}
                onPay={setPaying}
              />
            </div>
            <InvoiceSheet
              invoice={billing.data?.invoices.find((i) => i.id === invoiceId)}
              onOpenChange={(open) => !open && openInvoice(undefined)}
            />
            <PayDialog
              policyId={policy.data.id}
              invoice={paying}
              onOpenChange={(open) => !open && setPaying(null)}
            />
          </>
        )}
      </PageBody>
    </>
  );
}

function TabContent({
  tab,
  policy,
  billing,
  onOpenInvoice,
  onPay,
}: {
  tab: PolicyTab;
  policy: Policy;
  billing: Billing | undefined;
  onOpenInvoice: (invoiceId: string) => void;
  onPay: (invoice: Invoice) => void;
}) {
  switch (tab) {
    case "overview":
      return (
        <>
          <PolicyOverview policy={policy} billing={billing} />
          <ProducerOfRecord policy={policy} />
        </>
      );
    case "coverage":
      return <PolicyCoverage policy={policy} />;
    case "activity":
      return (
        <ActivityTimeline
          policy={policy}
          invoices={billing?.invoices ?? []}
          onOpenInvoice={onOpenInvoice}
        />
      );
    case "billing":
      return billing ? (
        <div className="grid gap-6">
          <BilledTo policyId={policy.id} billing={billing} />
          <BillingPanel billing={billing} onOpenInvoice={onOpenInvoice} onPay={onPay} />
        </div>
      ) : (
        <div className="h-96 animate-pulse rounded-xl bg-muted/60" />
      );
    case "documents":
      return <PolicyDocuments policy={policy} />;
    case "transactions":
      return <PolicyTransactions policy={policy} />;
  }
}
