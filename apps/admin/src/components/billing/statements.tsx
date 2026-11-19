import type { AdminOutputs } from "@pas/api-client";
import { EmptyState } from "@pas/ui/components/empty-state";
import { Panel } from "@pas/ui/components/panel";
import { StatusChip, type StatusTone } from "@pas/ui/components/status-chip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pas/ui/components/table";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ReceiptText } from "lucide-react";
import { formatMoney, formatPlainDate } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";

export type Statement = AdminOutputs["billing"]["statements"]["get"];

const STATUS: Record<string, { label: string; tone: StatusTone }> = {
  open: { label: "Open", tone: "neutral" },
  partially_paid: { label: "Partially paid", tone: "warning" },
  paid: { label: "Paid", tone: "success" },
  past_due: { label: "Past due", tone: "danger" },
  credit: { label: "Credit", tone: "neutral" },
};

export function StatementStatus({ status }: { status: string }) {
  const { label, tone } = STATUS[status] ?? { label: status, tone: "neutral" as const };

  return <StatusChip tone={tone}>{label}</StatusChip>;
}

const dash = <span className="text-muted-foreground">—</span>;

const amountOrDash = (value: { amount: string; currency: string }) =>
  Number(value.amount) === 0 ? dash : formatMoney(value);

/** Account current statements, newest first; rows open the statement. */
export function StatementsTable({ agencyId }: { agencyId?: string }) {
  const trpc = useTRPC();
  const navigate = useNavigate();

  const statements = useQuery(
    trpc.billing.statements.list.queryOptions(agencyId ? { agencyId } : {}),
  );

  const open = (statementId: string) =>
    navigate({ to: "/billing/statements/$statementId", params: { statementId } });

  return (
    <Panel flush>
      {statements.data?.length === 0 ? (
        <EmptyState
          icon={<ReceiptText />}
          title="No statements yet"
          description="Agency-billed policies go on the agency's next account current."
        />
      ) : (
        <>
          <Table className="hidden lg:table">
            <TableHeader>
              <TableRow>
                <TableHead>Statement</TableHead>
                {!agencyId && <TableHead>Agency</TableHead>}
                <TableHead>Period</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">Commission</TableHead>
                <TableHead className="text-right">Due</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!statements.data && (
                <TableRow className="h-13">
                  <TableCell colSpan={9}>
                    <div className="h-5 w-72 animate-pulse rounded bg-muted" />
                  </TableCell>
                </TableRow>
              )}
              {statements.data?.map((s) => (
                <TableRow
                  key={s.id}
                  className="h-13 cursor-pointer hover:bg-muted/40"
                  onClick={() => open(s.id)}
                >
                  <TableCell className="font-medium tabular-nums">{s.number}</TableCell>
                  {!agencyId && <TableCell>{s.agencyName}</TableCell>}
                  <TableCell className="text-muted-foreground tabular-nums">
                    {formatPlainDate(s.periodStart)} – {formatPlainDate(s.periodEnd)}
                  </TableCell>
                  <TableCell className="tabular-nums">{formatPlainDate(s.dueOn)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(s.totals.gross)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {amountOrDash(s.totals.commission)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(s.totals.due)}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {amountOrDash(s.totals.balance)}
                  </TableCell>
                  <TableCell>
                    <StatementStatus status={s.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <ul className="m-0 list-none divide-y p-0 lg:hidden">
            {statements.data?.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => open(s.id)}
                  className="grid w-full grid-cols-1 gap-1 px-(--card-p) py-3.5 text-left hover:bg-muted/40"
                >
                  <span className="flex min-w-0 items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-medium tabular-nums">
                      {s.number} · {s.agencyName}
                    </span>
                    <span className="shrink-0">
                      <StatementStatus status={s.status} />
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    Due {formatPlainDate(s.dueOn)} · {formatMoney(s.totals.balance)} open of{" "}
                    {formatMoney(s.totals.due)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
