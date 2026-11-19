import { Checkbox } from "@pas/ui/components/checkbox";
import { EmptyState } from "@pas/ui/components/empty-state";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { Panel } from "@pas/ui/components/panel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pas/ui/components/table";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Receipt } from "lucide-react";
import { useState } from "react";
import { formatMoney, formatPlainDate } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";

const TRANSACTION_LABELS: Record<string, string> = {
  NEW_BUSINESS: "New business",
  ENDORSEMENT: "Endorsement",
  CANCELLATION: "Cancellation",
  CANCELLATION_RESCISSION: "Rescission",
  REINSTATEMENT: "Reinstatement",
};

const monthStart = () => `${new Date().toISOString().slice(0, 7)}-01`;
const today = () => new Date().toISOString().slice(0, 10);

function Amount({ value }: { value: { amount: string; currency: string } }) {
  return Number(value.amount) === 0 ? (
    <span className="text-muted-foreground">—</span>
  ) : (
    <>{formatMoney(value.amount, value.currency)}</>
  );
}

/** An agency's commission statement for a period: gross premium, commission and net due. */
export function AgencyStatement({
  agencyId,
  hasSubAgencies,
}: {
  agencyId: string;
  hasSubAgencies: boolean;
}) {
  const trpc = useTRPC();
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [includeSubAgencies, setIncludeSubAgencies] = useState(hasSubAgencies);

  const statement = useQuery(
    trpc.distribution.statement.queryOptions(
      { agencyId, from, to, includeSubAgencies },
      { enabled: Boolean(from && to && from <= to) },
    ),
  );

  const data = statement.data;

  return (
    <Panel
      flush
      title="Commission statement"
      description="Commission on premium transactions recorded in the period. Payouts aren't tracked yet."
      footer={
        data &&
        data.entries.length > 0 && (
          <dl className="m-0 grid grid-cols-3 gap-4 text-sm">
            {(
              [
                ["Gross premium", data.totals.gross],
                ["Commission", data.totals.commission],
                ["Net due", data.totals.net],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="grid gap-0.5 sm:text-right">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="m-0 font-semibold tabular-nums">
                  {formatMoney(value.amount, value.currency)}
                </dd>
              </div>
            ))}
          </dl>
        )
      }
    >
      <div className="flex flex-wrap items-end gap-4 border-b px-(--card-p) py-3">
        <div className="grid gap-1.5">
          <Label htmlFor="statement-from" className="text-xs text-muted-foreground">
            From
          </Label>
          <Input
            id="statement-from"
            type="date"
            value={from}
            className="h-8 w-40"
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="statement-to" className="text-xs text-muted-foreground">
            To
          </Label>
          <Input
            id="statement-to"
            type="date"
            value={to}
            className="h-8 w-40"
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        {hasSubAgencies && (
          <label className="flex h-8 items-center gap-2 text-sm">
            <Checkbox
              checked={includeSubAgencies}
              onCheckedChange={(c) => setIncludeSubAgencies(c === true)}
            />
            Include sub-agencies
          </label>
        )}
      </div>
      {statement.isPending ? (
        <div className="m-(--card-p) h-24 animate-pulse rounded-lg bg-muted/60" />
      ) : !data || data.entries.length === 0 ? (
        <EmptyState
          icon={<Receipt />}
          title="No commission in this period"
          description="Bound and endorsed policies add lines here."
        />
      ) : (
        <>
          <Table className="hidden lg:table">
            <TableHeader>
              <TableRow>
                <TableHead>Recorded</TableHead>
                <TableHead>Policy</TableHead>
                <TableHead>Transaction</TableHead>
                {includeSubAgencies && <TableHead>Agency</TableHead>}
                <TableHead className="text-right">Premium</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="text-right">Commission</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.entries.map((entry) => (
                <TableRow key={entry.id} className="h-13">
                  <TableCell className="text-muted-foreground tabular-nums">
                    {formatPlainDate(entry.recordedAt.slice(0, 10))}
                  </TableCell>
                  <TableCell>
                    <Link
                      to="/policies/$policyId"
                      params={{ policyId: entry.policyId }}
                      className="font-medium tabular-nums hover:underline"
                    >
                      {entry.policyNumber}
                    </Link>
                    <span className="block max-w-48 truncate text-xs text-muted-foreground">
                      {entry.insuredName}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {TRANSACTION_LABELS[entry.transactionType] ?? entry.transactionType}
                    {entry.business === "renewal" && " · renewal"}
                  </TableCell>
                  {includeSubAgencies && (
                    <TableCell className="text-muted-foreground">{entry.agencyName}</TableCell>
                  )}
                  <TableCell className="text-right tabular-nums">
                    <Amount value={entry.premium} />
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">
                    {Number(entry.rate)}%
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    <Amount value={entry.amount} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <ul className="m-0 list-none divide-y p-0 lg:hidden">
            {data.entries.map((entry) => (
              <li key={entry.id} className="grid gap-1 px-(--card-p) py-3.5">
                <span className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium tabular-nums">{entry.policyNumber}</span>
                  <span className="font-medium tabular-nums">
                    <Amount value={entry.amount} />
                  </span>
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {TRANSACTION_LABELS[entry.transactionType] ?? entry.transactionType} ·{" "}
                  {formatMoney(entry.premium.amount, entry.premium.currency)} at{" "}
                  {Number(entry.rate)}%
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
