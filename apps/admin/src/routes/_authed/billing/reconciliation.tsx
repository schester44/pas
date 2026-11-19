import { Button } from "@pas/ui/components/button";
import { Card } from "@pas/ui/components/card";
import { EmptyState } from "@pas/ui/components/empty-state";
import { Notice } from "@pas/ui/components/notice";
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import { Spinner } from "@pas/ui/components/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pas/ui/components/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Scale } from "lucide-react";
import {
  Amount,
  ExternalBillingNotice,
  useLedgerOverview,
  WorkStatus,
} from "@/components/ledger/shared";
import { formatDateTime, formatPlainDate } from "@/lib/format";
import { useAccess } from "@/lib/permissions";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/billing/reconciliation")({
  component: ReconciliationPage,
});

function ReconciliationPage() {
  const trpc = useTRPC();
  const access = useAccess();
  const queryClient = useQueryClient();
  const overview = useLedgerOverview();
  const runs = useQuery(trpc.ledger.reconciliations.queryOptions());

  const reconcile = useMutation(
    trpc.ledger.reconcile.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: trpc.ledger.reconciliations.queryKey() }),
    }),
  );

  const latest = runs.data?.[0];
  const native = overview.data?.native !== false;

  return (
    <>
      <PageHeader
        title="Reconciliation"
        actions={
          native &&
          access.billing.write && (
            <Button onClick={() => reconcile.mutate()} disabled={reconcile.isPending}>
              {reconcile.isPending && <Spinner />}
              Reconcile now
            </Button>
          )
        }
      />
      <PageBody className="max-w-6xl">
        {!native && <ExternalBillingNotice />}
        {reconcile.error && (
          <Notice tone="error" title="Couldn't reconcile">
            {reconcile.error.message}
          </Notice>
        )}
        {runs.data?.length === 0 ? (
          <Panel>
            <EmptyState
              icon={<Scale />}
              title="Not reconciled yet"
              description="The ledger reconciles against PAS invoices at the end of every day."
            />
          </Panel>
        ) : (
          latest && (
            <>
              <div className="grid gap-6 sm:grid-cols-3">
                <Figure
                  label="Differences"
                  value={String(latest.differences.length + latest.cacheDrift.length)}
                >
                  <WorkStatus status={latest.status} />
                </Figure>
                <Figure label="Ledger receivables">
                  <Amount value={latest.ledgerTotal} />
                </Figure>
                <Figure label="PAS open balances">
                  <Amount value={latest.pasTotal} />
                </Figure>
              </div>
              <Panel
                flush
                title="Latest run"
                description={`${latest.invoices} invoices compared, ${formatDateTime(latest.ranAt)}.`}
              >
                {latest.differences.length === 0 && latest.cacheDrift.length === 0 ? (
                  <EmptyState title="Every invoice agrees with PAS, and every cached balance with its lines." />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Invoice or account</TableHead>
                        <TableHead className="text-right">Ledger</TableHead>
                        <TableHead className="text-right">PAS</TableHead>
                        <TableHead className="text-right">Difference</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {latest.differences.map((d) => (
                        <TableRow key={d.invoiceId}>
                          <TableCell className="font-medium tabular-nums">{d.number}</TableCell>
                          <TableCell className="text-right">
                            <Amount value={d.ledger} />
                          </TableCell>
                          <TableCell className="text-right">
                            <Amount value={d.pas} />
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            <Amount value={d.difference} />
                          </TableCell>
                        </TableRow>
                      ))}
                      {latest.cacheDrift.map((d) => (
                        <TableRow key={`${d.account}:${d.currency}`}>
                          <TableCell className="font-medium tabular-nums">
                            Account {d.account} cache
                          </TableCell>
                          <TableCell className="text-right">
                            <Amount value={{ amount: d.cached, currency: d.currency }} />
                          </TableCell>
                          <TableCell className="text-right">
                            <Amount value={{ amount: d.derived, currency: d.currency }} />
                          </TableCell>
                          <TableCell className="text-right" />
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Panel>
              <Panel flush title="History">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Day</TableHead>
                      <TableHead>Ran</TableHead>
                      <TableHead className="text-right">Invoices</TableHead>
                      <TableHead className="text-right">Differences</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.data?.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="tabular-nums">{formatPlainDate(r.asOf)}</TableCell>
                        <TableCell className="tabular-nums">{formatDateTime(r.ranAt)}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.invoices}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.differences.length + r.cacheDrift.length || (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <WorkStatus status={r.status} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Panel>
            </>
          )
        )}
      </PageBody>
    </>
  );
}

function Figure({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children?: React.ReactNode;
}) {
  return (
    <Card className="grid gap-2 p-(--card-p)">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="flex items-center gap-3 text-3xl leading-9 font-semibold tracking-tight tabular-nums">
        {value ?? children}
        {value && children}
      </span>
    </Card>
  );
}
