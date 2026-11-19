import { Button } from "@pas/ui/components/button";
import { Input } from "@pas/ui/components/input";
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import { SegmentedControl } from "@pas/ui/components/segmented-control";
import { StatusChip } from "@pas/ui/components/status-chip";
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
import { EntriesTable, EntrySheet } from "@/components/ledger/entry-sheet";
import {
  Amount,
  downloadCsv,
  ExternalBillingNotice,
  useLedgerOverview,
} from "@/components/ledger/shared";
import { useTRPC } from "@/lib/trpc";

const TABS = ["journal", "accounts", "trial_balance"] as const;

type Tab = (typeof TABS)[number];

export const Route = createFileRoute("/_authed/billing/ledger")({
  validateSearch: (search: Record<string, unknown>): { tab?: Tab; account?: string } => ({
    ...(TABS.includes(search.tab as Tab) && { tab: search.tab as Tab }),
    ...(typeof search.account === "string" && { account: search.account }),
  }),
  component: LedgerPage,
});

function LedgerPage() {
  const { tab = "journal", account } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const overview = useLedgerOverview();
  const [entryId, setEntryId] = useState<string | null>(null);

  return (
    <>
      <PageHeader title="Ledger" />
      <PageBody className="max-w-6xl">
        {overview.data?.native === false && <ExternalBillingNotice />}
        <SegmentedControl
          label="Ledger views"
          className="self-start"
          value={tab}
          onValueChange={(next) => navigate({ search: next === "journal" ? {} : { tab: next } })}
          options={[
            { value: "journal", label: "Journal" },
            { value: "accounts", label: "Accounts" },
            { value: "trial_balance", label: "Trial balance" },
          ]}
        />
        {tab === "journal" && <Journal account={account} onOpen={setEntryId} />}
        {tab === "accounts" && (
          <Accounts onAccount={(code) => navigate({ search: { account: code } })} />
        )}
        {tab === "trial_balance" && <TrialBalance />}
      </PageBody>
      <EntrySheet
        entryId={entryId}
        onOpen={setEntryId}
        onOpenChange={(open) => !open && setEntryId(null)}
      />
    </>
  );
}

function Journal({
  account,
  onOpen,
}: {
  account: string | undefined;
  onOpen: (id: string) => void;
}) {
  const trpc = useTRPC();
  const accounts = useQuery(trpc.ledger.accounts.queryOptions());

  const entries = useQuery(
    trpc.ledger.entries.queryOptions({ ...(account && { account }), limit: 200 }),
  );

  const name = accounts.data?.find((a) => a.code === account)?.name;

  return (
    <EntriesTable
      entries={entries.data}
      onOpen={onOpen}
      {...(account && {
        title: `${account} ${name ?? ""}`,
        description: "Entries that touch this account.",
      })}
    />
  );
}

function Accounts({ onAccount }: { onAccount: (code: string) => void }) {
  const trpc = useTRPC();
  const accounts = useQuery(trpc.ledger.accounts.queryOptions());

  return (
    <Panel
      flush
      description="Cached balances, kept in step with every posting and checked by the daily reconciliation."
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Account</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Balance</TableHead>
            <TableHead className="text-right">Postings</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {accounts.data?.map((a) => (
            <TableRow
              key={`${a.code}:${a.currency}`}
              className="cursor-pointer hover:bg-muted/40"
              onClick={() => onAccount(a.code)}
            >
              <TableCell>
                <span className="font-medium tabular-nums">{a.code}</span> {a.name}
              </TableCell>
              <TableCell className="text-muted-foreground capitalize">{a.type}</TableCell>
              <TableCell className="text-right">
                <Amount value={{ amount: a.natural, currency: a.currency }} />
              </TableCell>
              <TableCell className="text-right text-muted-foreground tabular-nums">
                {a.version || "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Panel>
  );
}

function TrialBalance() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const overview = useLedgerOverview();
  const [asOf, setAsOf] = useState("");
  const date = asOf || overview.data?.today || "";

  const tb = useQuery({
    ...trpc.ledger.trialBalance.queryOptions({ asOf: date }),
    enabled: Boolean(date),
  });

  return (
    <Panel
      flush
      title="Trial balance"
      description={
        tb.data && (tb.data.balanced ? "Debits equal credits." : "Debits and credits differ.")
      }
      action={
        <div className="flex items-center gap-2">
          {tb.data && (
            <StatusChip tone={tb.data.balanced ? "success" : "danger"}>
              {tb.data.balanced ? "Balanced" : "Out of balance"}
            </StatusChip>
          )}
          <Input
            aria-label="As of"
            type="date"
            className="h-8 w-40 tabular-nums"
            value={date}
            onChange={(e) => setAsOf(e.target.value)}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={async () =>
              downloadCsv(
                await queryClient.fetchQuery(
                  trpc.ledger.csv.queryOptions({ report: "trial_balance", asOf: date }),
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
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Account</TableHead>
            <TableHead className="text-right">Debit</TableHead>
            <TableHead className="text-right">Credit</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tb.data?.rows.map((r) => (
            <TableRow key={r.code}>
              <TableCell>
                <span className="font-medium tabular-nums">{r.code}</span> {r.name}
              </TableCell>
              <TableCell className="text-right">
                <Amount value={r.debit} />
              </TableCell>
              <TableCell className="text-right">
                <Amount value={r.credit} />
              </TableCell>
            </TableRow>
          ))}
          {tb.data && (
            <TableRow className="bg-muted/40 font-semibold">
              <TableCell>Total</TableCell>
              <TableCell className="text-right">
                <Amount value={tb.data.debits} />
              </TableCell>
              <TableCell className="text-right">
                <Amount value={tb.data.credits} />
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Panel>
  );
}
