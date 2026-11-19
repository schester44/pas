import { Button } from "@pas/ui/components/button";
import { Notice } from "@pas/ui/components/notice";
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import { PdfPreview } from "@pas/ui/components/pdf-preview";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pas/ui/components/table";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Breadcrumb } from "@/components/catalog/breadcrumb";
import {
  SimulateBillingEvent,
  type SimulationTarget,
  useSimulation,
} from "@/components/billing/simulate-billing-event";
import { money, type Statement, StatementStatus } from "@/components/billing/statements";
import { formatPlainDate } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/billing/statements/$statementId")({
  component: StatementPage,
});

const fromBase64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
const dash = <span className="text-muted-foreground">—</span>;

const TRANSACTION: Record<string, string> = {
  NEW_BUSINESS: "New business",
  ENDORSEMENT: "Endorsement",
  CANCELLATION: "Cancellation",
  REINSTATEMENT: "Reinstatement",
};

function StatementPage() {
  const { statementId } = Route.useParams();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const simulation = useSimulation();
  const [target, setTarget] = useState<SimulationTarget | null>(null);
  const statement = useQuery(trpc.billing.statements.get.queryOptions({ id: statementId }));

  const document = useQuery({
    ...trpc.billing.statements.document.queryOptions({ id: statementId }),
    enabled: statement.data?.hasDocument === true,
  });

  const pdf = useMemo(
    () => (document.data ? fromBase64(document.data.pdf) : null),
    [document.data],
  );

  const s = statement.data;

  return (
    <>
      <PageHeader
        title={
          <Breadcrumb
            parents={[
              <Link key="statements" to="/billing/statements">
                Agency statements
              </Link>,
            ]}
            current={s?.number}
          />
        }
        actions={
          s &&
          simulation &&
          Number(s.totals.paid.amount) + Number(s.totals.balance.amount) > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setTarget({
                  statementId: s.id,
                  label: `account current ${s.number}`,
                  balance: s.totals.balance,
                })
              }
            >
              Simulate billing event
            </Button>
          )
        }
      />
      <PageBody className="max-w-6xl">
        {statement.error ? (
          <Notice tone="error" title="Couldn't load this statement">
            {statement.error.message}
          </Notice>
        ) : !s ? (
          <div className="h-80 animate-pulse rounded-xl bg-muted/60" />
        ) : (
          <>
            <Summary statement={s} />
            <Items statement={s} />
            {pdf && (
              <Panel
                title="Statement PDF"
                description={
                  s.emailedTo.length ? `Emailed to ${s.emailedTo.join(", ")}` : undefined
                }
              >
                <PdfPreview data={pdf} label={`Account current ${s.number}`} />
              </Panel>
            )}
          </>
        )}
        <SimulateBillingEvent
          target={target}
          onOpenChange={(open) => !open && setTarget(null)}
          onApplied={() =>
            queryClient.invalidateQueries({ queryKey: trpc.billing.statements.get.queryKey() })
          }
        />
      </PageBody>
    </>
  );
}

function Summary({ statement: s }: { statement: Statement }) {
  const facts = [
    ["Gross", money(s.totals.gross)],
    ["Commission", money(s.totals.commission)],
    [s.remittanceBasis === "net" ? "Net due" : "Due", money(s.totals.due)],
    ["Paid", money(s.totals.paid)],
    ["Balance", money(s.totals.balance)],
  ] as const;

  return (
    <Panel
      title={
        <Link
          to="/agencies/$agencyId"
          params={{ agencyId: s.agencyId }}
          className="hover:underline"
        >
          {s.agencyName}
        </Link>
      }
      description={
        <span className="tabular-nums">
          {formatPlainDate(s.periodStart)} – {formatPlainDate(s.periodEnd)} · issued{" "}
          {formatPlainDate(s.issuedOn)} · due {formatPlainDate(s.dueOn)} ·{" "}
          {s.remittanceBasis === "net" ? "net of commission" : "gross"}
          {s.remindedOn && ` · reminder sent ${formatPlainDate(s.remindedOn)}`}
          {s.suspendedOn && ` · agency bill suspended ${formatPlainDate(s.suspendedOn)}`}
        </span>
      }
      action={<StatementStatus status={s.status} />}
    >
      <dl className="m-0 grid grid-cols-2 gap-4 sm:grid-cols-5">
        {facts.map(([label, value]) => (
          <div key={label} className="grid gap-1">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="m-0 text-xl font-semibold tracking-tight tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

function Items({ statement: s }: { statement: Statement }) {
  return (
    <Panel title="Items" flush>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Policy</TableHead>
            <TableHead>Transaction</TableHead>
            <TableHead>Effective</TableHead>
            <TableHead className="text-right">Gross</TableHead>
            <TableHead className="text-right">Commission</TableHead>
            <TableHead className="text-right">Due</TableHead>
            <TableHead className="text-right">Applied</TableHead>
            <TableHead className="text-right">Open</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {s.items.map((item) => {
            const applied = Number(item.credited.amount) + Number(item.paid.amount);

            return (
              <TableRow key={item.id} className="h-13">
                <TableCell>
                  <Link
                    to="/policies/$policyId"
                    params={{ policyId: item.policyId }}
                    search={{ tab: "billing" }}
                    className="font-medium tabular-nums hover:underline"
                  >
                    {item.policyNumber}
                  </Link>
                  <span className="block text-xs text-muted-foreground">{item.insuredName}</span>
                </TableCell>
                <TableCell>
                  {TRANSACTION[item.transactionType] ?? item.transactionType}
                  <span className="block text-xs text-muted-foreground tabular-nums">
                    {item.invoiceNumber}
                  </span>
                </TableCell>
                <TableCell className="tabular-nums">
                  {formatPlainDate(item.effectiveDate)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{money(item.gross)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(item.commission)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(item.due)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {applied === 0
                    ? dash
                    : money({ amount: applied.toFixed(2), currency: item.due.currency })}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {Number(item.open.amount) === 0 ? dash : money(item.open)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Panel>
  );
}
