import { Button } from "@pas/ui/components/button";
import { EmptyState } from "@pas/ui/components/empty-state";
import { Input } from "@pas/ui/components/input";
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import { SegmentedControl } from "@pas/ui/components/segmented-control";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pas/ui/components/table";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { useState } from "react";
import {
  Amount,
  downloadCsv,
  ExternalBillingNotice,
  RAIL_LABEL,
  useLedgerOverview,
  WorkStatus,
} from "@/components/ledger/shared";
import { formatPlainDate } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";

const REPORTS = [
  "ar_aging",
  "unapplied_cash",
  "deposits",
  "carrier_payable",
  "taxes_payable",
] as const;

type Report = (typeof REPORTS)[number];

const TITLES: Record<Report, string> = {
  ar_aging: "Receivables aging",
  unapplied_cash: "Unapplied cash",
  deposits: "Deposits by batch",
  carrier_payable: "Premium payable to carrier",
  taxes_payable: "Taxes and fees payable",
};

const PAYERS: Record<string, string> = {
  insured: "Insureds",
  agency: "Agencies",
  mortgagee: "Mortgagees",
};

const BUCKETS = [
  ["current", "Current"],
  ["1_30", "1–30"],
  ["31_60", "31–60"],
  ["61_90", "61–90"],
  ["over_90", "Over 90"],
] as const;

export const Route = createFileRoute("/_authed/billing/reports")({
  validateSearch: (search: Record<string, unknown>): { report?: Report } =>
    REPORTS.includes(search.report as Report) ? { report: search.report as Report } : {},
  component: ReportsPage,
});

function ReportsPage() {
  const { report = "ar_aging" } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const overview = useLedgerOverview();
  const [asOf, setAsOf] = useState("");
  const date = asOf || overview.data?.today || "";
  const dated = report !== "unapplied_cash" && report !== "deposits";

  return (
    <>
      <PageHeader title="Billing reports" />
      <PageBody className="max-w-6xl">
        {overview.data?.native === false && <ExternalBillingNotice />}
        <SegmentedControl
          label="Report"
          className="self-start"
          value={report}
          onValueChange={(next) =>
            navigate({ search: next === "ar_aging" ? {} : { report: next } })
          }
          options={[
            { value: "ar_aging", label: "Aging" },
            { value: "unapplied_cash", label: "Unapplied cash" },
            { value: "deposits", label: "Deposits" },
            { value: "carrier_payable", label: "Carrier payable" },
            { value: "taxes_payable", label: "Taxes payable" },
          ]}
        />
        <Panel
          flush
          title={TITLES[report]}
          action={
            <div className="flex items-center gap-2">
              {dated && (
                <Input
                  aria-label="As of"
                  type="date"
                  className="h-8 w-40 tabular-nums"
                  value={date}
                  onChange={(e) => setAsOf(e.target.value)}
                />
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={async () =>
                  downloadCsv(
                    await queryClient.fetchQuery(
                      trpc.ledger.csv.queryOptions({ report, ...(date && { asOf: date }) }),
                    ),
                  )
                }
              >
                <Download />
                CSV
              </Button>
            </div>
          }
        >
          {report === "ar_aging" && date && <Aging asOf={date} />}
          {report === "unapplied_cash" && <Unapplied />}
          {report === "deposits" && <Deposits />}
          {report === "carrier_payable" && date && <CarrierPayable asOf={date} />}
          {report === "taxes_payable" && date && <TaxesPayable asOf={date} />}
        </Panel>
      </PageBody>
    </>
  );
}

function Aging({ asOf }: { asOf: string }) {
  const trpc = useTRPC();
  const aging = useQuery(trpc.ledger.aging.queryOptions({ asOf }));

  if (aging.data?.rows.length === 0) return <EmptyState title="Nothing is owed" />;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Payer</TableHead>
          {BUCKETS.map(([key, label]) => (
            <TableHead key={key} className="text-right">
              {label}
            </TableHead>
          ))}
          <TableHead className="text-right">Credits</TableHead>
          <TableHead className="text-right">Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {aging.data?.rows.map((r) => (
          <TableRow key={r.payerType}>
            <TableCell className="font-medium">{PAYERS[r.payerType] ?? r.payerType}</TableCell>
            {BUCKETS.map(([key]) => (
              <TableCell key={key} className="text-right">
                <Amount value={r.buckets[key]} />
              </TableCell>
            ))}
            <TableCell className="text-right">
              <Amount value={r.credits} />
            </TableCell>
            <TableCell className="text-right font-medium">
              <Amount value={r.total} />
            </TableCell>
          </TableRow>
        ))}
        {aging.data && (
          <TableRow className="bg-muted/40 font-semibold">
            <TableCell>Total</TableCell>
            {BUCKETS.map(([key]) => (
              <TableCell key={key} className="text-right">
                <Amount value={aging.data.totals.buckets[key]} />
              </TableCell>
            ))}
            <TableCell className="text-right">
              <Amount value={aging.data.totals.credits} />
            </TableCell>
            <TableCell className="text-right">
              <Amount value={aging.data.totals.total} />
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

function Unapplied() {
  const trpc = useTRPC();
  const payments = useQuery(trpc.ledger.payments.queryOptions({ unappliedOnly: true }));

  if (payments.data?.length === 0) return <EmptyState title="No unapplied cash" />;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Payment</TableHead>
          <TableHead>Received</TableHead>
          <TableHead>Payer</TableHead>
          <TableHead>Method</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead className="text-right">Unapplied</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {payments.data?.map((p) => (
          <TableRow key={p.id}>
            <TableCell className="font-medium tabular-nums">{p.number}</TableCell>
            <TableCell className="tabular-nums">{formatPlainDate(p.receivedOn)}</TableCell>
            <TableCell>
              {p.payerName ?? <span className="text-muted-foreground">Unidentified</span>}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {RAIL_LABEL[p.rail]}
              {p.reference && ` · ${p.reference}`}
            </TableCell>
            <TableCell className="text-right">
              <Amount value={p.amount} />
            </TableCell>
            <TableCell className="text-right font-medium">
              <Amount value={p.unapplied} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Deposits() {
  const trpc = useTRPC();
  const batches = useQuery(trpc.ledger.batches.queryOptions());

  if (batches.data?.length === 0) return <EmptyState title="No deposit batches" />;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Batch</TableHead>
          <TableHead>Rail</TableHead>
          <TableHead>Deposited</TableHead>
          <TableHead className="text-right">Payments</TableHead>
          <TableHead className="text-right">Total</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {batches.data?.map((b) => (
          <TableRow key={b.id}>
            <TableCell className="font-medium tabular-nums">{b.number}</TableCell>
            <TableCell>{RAIL_LABEL[b.rail]}</TableCell>
            <TableCell className="tabular-nums">
              {b.depositedOn ? formatPlainDate(b.depositedOn) : "—"}
            </TableCell>
            <TableCell className="text-right tabular-nums">{b.payments}</TableCell>
            <TableCell className="text-right">
              <Amount value={b.total} />
            </TableCell>
            <TableCell>
              <WorkStatus status={b.status} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function CarrierPayable({ asOf }: { asOf: string }) {
  const trpc = useTRPC();
  const rows = useQuery(trpc.ledger.carrierPayable.queryOptions({ asOf }));

  if (rows.data?.length === 0) return <EmptyState title="Nothing payable to the carrier" />;

  const m = (amount: string, currency: string) => ({ amount, currency });

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Policy</TableHead>
          <TableHead className="text-right">Gross premium</TableHead>
          <TableHead className="text-right">Commission</TableHead>
          <TableHead className="text-right">Net payable</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.data?.map((r) => (
          <TableRow key={r.policyId}>
            <TableCell className="font-medium tabular-nums">{r.policyNumber ?? "—"}</TableCell>
            <TableCell className="text-right">
              <Amount value={m(r.gross, r.currency)} />
            </TableCell>
            <TableCell className="text-right">
              <Amount value={m(r.commission, r.currency)} />
            </TableCell>
            <TableCell className="text-right font-medium">
              <Amount value={m(r.net, r.currency)} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function TaxesPayable({ asOf }: { asOf: string }) {
  const trpc = useTRPC();
  const rows = useQuery(trpc.ledger.taxesPayable.queryOptions({ asOf }));

  if (rows.data?.length === 0) return <EmptyState title="No taxes or fees payable" />;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Jurisdiction</TableHead>
          <TableHead className="text-right">Payable</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.data?.map((r) => (
          <TableRow key={`${r.jurisdiction}:${r.currency}`}>
            <TableCell className="font-medium">{r.jurisdiction}</TableCell>
            <TableCell className="text-right">
              <Amount value={{ amount: r.balance, currency: r.currency }} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
