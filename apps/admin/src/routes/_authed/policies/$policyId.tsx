import type { AdminOutputs } from "@pas/api-client";
import { Button } from "@pas/ui/components/button";
import { Notice } from "@pas/ui/components/notice";
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import { Spinner } from "@pas/ui/components/spinner";
import { jurisdictionName } from "@pas/ui/lib/jurisdictions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Download, FileText } from "lucide-react";
import type * as React from "react";
import { useState } from "react";
import { Breadcrumb } from "@/components/catalog/breadcrumb";
import { humanize } from "@/components/decisions/jdm-edit";
import { ActivityTimeline } from "@/components/policies/activity";
import { BillingPanel, InvoiceSheet } from "@/components/policies/billing";
import { PolicyClients } from "@/components/policies/clients";
import { PolicyStatus } from "@/components/policies/policy-status";
import { formatDate, formatMoney, formatPlainDate } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/policies/$policyId")({
  component: PolicyPage,
});

type Policy = AdminOutputs["policies"]["get"];
type Amount =
  | { kind: "money"; amount: string; currency: string }
  | { kind: "percent"; value: string };

const money = (value: { amount: string; currency: string }) =>
  formatMoney(value.amount, value.currency);

function amount(value: unknown) {
  const a = value as Amount | undefined;

  if (!a) return <span className="text-muted-foreground">–</span>;

  return a.kind === "money" ? formatMoney(a.amount, a.currency) : `${a.value}%`;
}

const exposureLabel = (exposure?: string) => {
  const match = exposure ? /\[(\d+)\]$/.exec(exposure) : null;

  return match ? `Location ${Number(match[1]) + 1}` : "Policy";
};

function PolicyPage() {
  const { policyId } = Route.useParams();
  const trpc = useTRPC();
  const policy = useQuery(trpc.policies.get.queryOptions({ id: policyId }));
  const billing = useQuery(trpc.policies.billing.queryOptions({ id: policyId }));
  const [invoiceId, setInvoiceId] = useState<string | null>(null);

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
        actions={policy.data && <PolicyStatus status={policy.data.status} />}
      />
      <PageBody className="max-w-6xl">
        {policy.error ? (
          <Notice tone="error" title="Couldn't load this policy">
            {policy.error.message}
          </Notice>
        ) : !policy.data ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="h-96 animate-pulse rounded-xl bg-muted/60" />
            <div className="h-72 animate-pulse rounded-xl bg-muted/60" />
          </div>
        ) : (
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="grid gap-6">
              <Coverages policy={policy.data} />
              <ActivityTimeline
                policy={policy.data}
                invoices={billing.data?.invoices ?? []}
                onOpenInvoice={setInvoiceId}
              />
              <Transactions policy={policy.data} />
              <Financials policy={policy.data} />
            </div>
            <div className="grid gap-6">
              <Term policy={policy.data} />
              <PolicyClients policyId={policy.data.id} />
              {billing.data && <BillingPanel billing={billing.data} onOpenInvoice={setInvoiceId} />}
              <Documents policy={policy.data} />
            </div>
            <InvoiceSheet
              invoice={billing.data?.invoices.find((i) => i.id === invoiceId)}
              onOpenChange={(open) => !open && setInvoiceId(null)}
            />
          </div>
        )}
      </PageBody>
    </>
  );
}

function Term({ policy }: { policy: Policy }) {
  return (
    <Panel title="Term">
      <dl className="m-0 grid gap-4">
        <Fact label="Named insured">{policy.insuredName}</Fact>
        <Fact label="Product">
          {policy.productName} <span className="tabular-nums">{policy.productVersion}</span>
        </Fact>
        <Fact label="State">{jurisdictionName(policy.jurisdiction)}</Fact>
        <Fact label="Term">
          <span className="tabular-nums">
            {formatPlainDate(policy.effectiveDate)} – {formatPlainDate(policy.expirationDate)}
          </span>
        </Fact>
        <Fact label="Written premium">
          <span className="tabular-nums">{money(policy.writtenPremium)}</span>
          <span className="block text-xs text-muted-foreground tabular-nums">
            {money(policy.taxesAndFees)} taxes and fees · {money(policy.total)} total
          </span>
        </Fact>
        <Fact label="Producer">{policy.producerName}</Fact>
        <Fact label="Bound">
          <span className="tabular-nums">{formatDate(policy.boundAt)}</span>
        </Fact>
        <Fact label="Submission">
          <Link
            to="/submissions/$submissionId"
            params={{ submissionId: policy.sourceSubmissionId }}
            className="font-medium text-primary outline-none hover:underline focus-visible:underline"
          >
            View the quote
          </Link>
        </Fact>
      </dl>
    </Panel>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="m-0 text-sm">{children}</dd>
    </div>
  );
}

function Coverages({ policy }: { policy: Policy }) {
  return (
    <Panel title="Coverages" flush>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="h-10 bg-muted/40 text-left text-xs font-medium text-muted-foreground">
            <th className="pl-(--card-p) font-medium">Coverage</th>
            <th className="px-3 text-right font-medium">Limit</th>
            <th className="px-3 text-right font-medium">Deductible</th>
            <th className="pr-(--card-p) text-right font-medium">Premium</th>
          </tr>
        </thead>
        <tbody>
          {policy.coverages.map((c) => (
            <tr key={`${c.coverage}@${c.exposure ?? ""}`} className="h-13 border-t">
              <td className="py-2.5 pl-(--card-p)">
                <span className="grid gap-0.5">
                  <span className="font-medium">{c.name}</span>
                  <span className="text-xs text-muted-foreground">{exposureLabel(c.exposure)}</span>
                </span>
              </td>
              <td className="px-3 text-right tabular-nums">{amount(c.limit)}</td>
              <td className="px-3 text-right tabular-nums">{amount(c.deductible)}</td>
              <td className="pr-(--card-p) text-right tabular-nums">{money(c.premium)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function Transactions({ policy }: { policy: Policy }) {
  return (
    <Panel title="Transactions" flush>
      <ul className="m-0 list-none divide-y p-0">
        {policy.transactions.map((t) => (
          <li key={t.id} className="flex items-center gap-4 px-(--card-p) py-3">
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="text-sm font-medium">{humanize(t.type.toLowerCase())}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                Effective {formatPlainDate(t.effectiveDate)} · issued {formatDate(t.issuedAt)}
              </span>
            </span>
            <span className="text-xs text-muted-foreground">{humanize(t.status)}</span>
            <span className="w-24 text-right text-sm tabular-nums">{money(t.premiumDelta)}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Financials({ policy }: { policy: Policy }) {
  return (
    <Panel
      title="Financial transactions"
      description="Written premium by coverage, plus taxes and fees."
      flush
    >
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="h-10 bg-muted/40 text-left text-xs font-medium text-muted-foreground">
            <th className="pl-(--card-p) font-medium">Line</th>
            <th className="px-3 font-medium">Kind</th>
            <th className="px-3 font-medium">Remitted by</th>
            <th className="pr-(--card-p) text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {policy.financials.map((f) => (
            <tr key={f.id} className="h-11 border-t">
              <td className="pl-(--card-p)">
                {f.label}
                {f.exposure && (
                  <span className="text-muted-foreground"> · {exposureLabel(f.exposure)}</span>
                )}
              </td>
              <td className="px-3 text-muted-foreground">
                {f.kind === "written_premium" ? "Written premium" : "Tax or fee"}
              </td>
              <td className="px-3 text-muted-foreground">
                {f.remitter ? humanize(f.remitter) : "–"}
              </td>
              <td className="pr-(--card-p) text-right tabular-nums">{money(f.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

const fromBase64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

function Documents({ policy }: { policy: Policy }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  async function download(documentId: string) {
    setBusy(documentId);

    try {
      const file = await queryClient.fetchQuery(
        trpc.policies.document.queryOptions({ policyId: policy.id, documentId }),
      );

      const url = URL.createObjectURL(
        new Blob([fromBase64(file.pdf)], { type: "application/pdf" }),
      );

      const link = document.createElement("a");
      link.href = url;
      link.download = file.fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel title="Documents" flush>
      <ul className="m-0 list-none divide-y p-0">
        {policy.documents.map((d) => (
          <li key={d.id} className="flex items-center gap-3 px-(--card-p) py-3">
            <FileText aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="grid min-w-0 flex-1">
              <span className="truncate text-sm font-medium">{d.title}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {Math.round(d.sizeBytes / 1024)} KB
              </span>
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Download ${d.title}`}
              disabled={busy === d.id}
              onClick={() => download(d.id)}
            >
              {busy === d.id ? <Spinner /> : <Download />}
            </Button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
