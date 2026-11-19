import type { AdminOutputs } from "@pas/api-client";
import { Button } from "@pas/ui/components/button";
import { Checkbox } from "@pas/ui/components/checkbox";
import { EmptyState } from "@pas/ui/components/empty-state";
import { Input } from "@pas/ui/components/input";
import { Notice } from "@pas/ui/components/notice";
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import { Spinner } from "@pas/ui/components/spinner";
import { cn } from "@pas/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { ApplyCreditDialog, type OpenItem, WriteOffDialog } from "@/components/ledger/item-actions";
import { RefundDialog } from "@/components/ledger/payment-sheet";
import {
  Amount,
  ExternalBillingNotice,
  money,
  PAYER_LABEL,
  RAIL_LABEL,
  useIdempotencyKey,
  useLedgerOverview,
  validAmount,
} from "@/components/ledger/shared";
import { formatPlainDate } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";

type Item = AdminOutputs["ledger"]["openItems"][number];
type Payment = AdminOutputs["ledger"]["payment"];

export const Route = createFileRoute("/_authed/billing/apply")({
  validateSearch: (search: Record<string, unknown>): { paymentId?: string } =>
    typeof search.paymentId === "string" ? { paymentId: search.paymentId } : {},
  component: CashApplicationPage,
});

const cents = (value: string) => Math.round(Number(value) * 100);
const fromCents = (value: number) => (value / 100).toFixed(2);

function CashApplicationPage() {
  const { paymentId } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const trpc = useTRPC();
  const overview = useLedgerOverview();

  const unapplied = useQuery(trpc.ledger.payments.queryOptions({ unappliedOnly: true }));

  const payment = useQuery({
    ...trpc.ledger.payment.queryOptions({ id: paymentId ?? "" }),
    enabled: Boolean(paymentId),
  });

  return (
    <>
      <PageHeader title="Cash application" />
      <PageBody className="max-w-6xl">
        {overview.data?.native === false && <ExternalBillingNotice />}
        <div className="grid items-start gap-6 lg:grid-cols-[18rem_1fr]">
          <Panel flush title="Unapplied cash">
            {unapplied.data?.length === 0 ? (
              <EmptyState title="Nothing waiting" description="Every payment is applied." />
            ) : (
              <ul className="m-0 list-none divide-y p-0">
                {unapplied.data?.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => navigate({ search: { paymentId: p.id } })}
                      className={cn(
                        "grid w-full gap-0.5 px-(--card-p) py-3 text-left outline-none transition-colors hover:bg-muted/40",
                        p.id === paymentId && "bg-primary/5",
                      )}
                    >
                      <span className="flex justify-between gap-2 text-sm font-medium tabular-nums">
                        {p.number}
                        <Amount value={p.unapplied} />
                      </span>
                      <span className="truncate text-xs text-muted-foreground tabular-nums">
                        {p.payerName ?? "Unidentified"} · {RAIL_LABEL[p.rail]} ·{" "}
                        {formatPlainDate(p.receivedOn)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <OpenItems payment={payment.data ?? null} />
        </div>
      </PageBody>
    </>
  );
}

function OpenItems({ payment }: { payment: Payment | null }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [statementAmount, setStatementAmount] = useState<Record<string, string>>({});
  const [key, renewKey] = useIdempotencyKey();
  const [writingOff, setWritingOff] = useState<OpenItem | null>(null);
  const [crediting, setCrediting] = useState<OpenItem | null>(null);
  const [refunding, setRefunding] = useState<Item | null>(null);

  const byPayer = payment?.payerType && payment.payerType !== "insured" && payment.payerRef;

  const items = useQuery({
    ...trpc.ledger.openItems.queryOptions(
      search.trim()
        ? { search: search.trim() }
        : byPayer
          ? { payerType: payment.payerType as "agency" | "mortgagee", payerRef: payment.payerRef }
          : { search: "" },
    ),
    enabled: Boolean(search.trim() || byPayer),
  });

  const apply = useMutation(
    trpc.ledger.applyPayment.mutationOptions({
      onSuccess: async () => {
        renewKey();
        setAmounts({});
        setStatementAmount({});
        await queryClient.invalidateQueries({ queryKey: trpc.ledger.pathKey() });
      },
    }),
  );

  const all = items.data ?? [];
  const invoices = all.filter((i) => i.kind === "invoice" && Number(i.balance.amount) > 0);
  const credits = all.filter((i) => Number(i.balance.amount) < 0);
  const currency = payment?.unapplied.currency ?? all[0]?.balance.currency ?? "USD";
  const available = payment ? cents(payment.unapplied.amount) : 0;

  const statements = useMemo(() => {
    const groups = new Map<
      string,
      { id: string; number: string; dueOn: string; balance: number }
    >();

    for (const i of invoices) {
      if (!i.statementId || !i.statementNumber) continue;

      const g = groups.get(i.statementId) ?? {
        id: i.statementId,
        number: i.statementNumber,
        dueOn: i.dueOn,
        balance: 0,
      };

      g.balance += cents(i.balance.amount);
      groups.set(i.statementId, g);
    }

    return [...groups.values()];
  }, [invoices]);

  const chosen = Object.entries(amounts).filter(([, v]) => validAmount(v));
  const applying = chosen.reduce((sum, [, v]) => sum + cents(v), 0);
  const over = applying > available;

  const toggle = (item: Item, on: boolean) => {
    const remaining = available - applying;
    const share = Math.max(0, Math.min(remaining, cents(item.balance.amount)));

    setAmounts((current) => {
      const next = { ...current };

      if (on) next[item.invoiceId] = fromCents(share || cents(item.balance.amount));
      else delete next[item.invoiceId];

      return next;
    });
  };

  return (
    <div className="grid gap-6">
      <Panel
        flush
        title={
          payment ? (
            <span className="tabular-nums">
              {payment.number}: {money(payment.unapplied)} to apply
            </span>
          ) : (
            "Open items"
          )
        }
        description={
          payment
            ? `${payment.payerName ?? "Unidentified payer"}${payment.payerType ? ` · ${PAYER_LABEL[payment.payerType]}` : ""}${payment.reference ? ` · ${payment.reference}` : ""}`
            : "Pick a payment to apply, or search for an invoice to write off or refund."
        }
        action={
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground"
            />
            <Input
              aria-label="Search open items"
              className="h-9 w-64 pl-8"
              placeholder="Invoice, policy, payer"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        }
        footer={
          payment && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span
                className={cn(
                  "text-sm tabular-nums",
                  over ? "text-destructive" : "text-muted-foreground",
                )}
              >
                Applying {money({ amount: fromCents(applying), currency })}
                {over
                  ? `, more than the ${money(payment.unapplied)} unapplied`
                  : ` · ${money({ amount: fromCents(available - applying), currency })} stays unapplied`}
              </span>
              <Button
                disabled={chosen.length === 0 || over || apply.isPending}
                onClick={() =>
                  apply.mutate({
                    paymentId: payment.id,
                    target: {
                      kind: "invoices",
                      allocations: chosen.map(([invoiceId, amount]) => ({
                        invoiceId,
                        amount: { amount, currency },
                      })),
                    },
                    idempotencyKey: key,
                  })
                }
              >
                {apply.isPending && <Spinner />}
                Apply payment
              </Button>
            </div>
          )
        }
      >
        {apply.error && (
          <Notice tone="error" title="Couldn't apply the payment" className="m-(--card-p)">
            {apply.error.message}
          </Notice>
        )}
        {payment && statements.length > 0 && (
          <ul className="m-0 list-none divide-y border-b p-0">
            {statements.map((s) => {
              const value = statementAmount[s.id] ?? fromCents(Math.min(available, s.balance));

              return (
                <li key={s.id} className="flex flex-wrap items-center gap-3 px-(--card-p) py-3">
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="text-sm font-medium tabular-nums">
                      Account current {s.number}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      Due {formatPlainDate(s.dueOn)} ·{" "}
                      {money({ amount: fromCents(s.balance), currency })} gross open
                    </span>
                  </span>
                  <Input
                    aria-label={`Amount for ${s.number}`}
                    inputMode="decimal"
                    className="h-8 w-28 text-right tabular-nums"
                    value={value}
                    onChange={(e) => setStatementAmount((c) => ({ ...c, [s.id]: e.target.value }))}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!validAmount(value) || cents(value) > available || apply.isPending}
                    onClick={() =>
                      apply.mutate({
                        paymentId: payment.id,
                        target: {
                          kind: "statement",
                          statementId: s.id,
                          amount: { amount: value, currency },
                        },
                        idempotencyKey: key,
                      })
                    }
                  >
                    Apply to statement
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        {!items.data && !search.trim() && !byPayer ? (
          <EmptyState
            icon={<Search />}
            title="Search for open items"
            description="Find the invoices this payment pays by invoice, policy or payer."
          />
        ) : invoices.length === 0 ? (
          <EmptyState title="No open invoices" />
        ) : (
          <ul className="m-0 list-none divide-y p-0">
            {invoices.map((item) => {
              const on = item.invoiceId in amounts;

              return (
                <li key={item.invoiceId} className="flex items-center gap-3 px-(--card-p) py-3">
                  {payment && (
                    <Checkbox
                      aria-label={`Apply to ${item.number}`}
                      checked={on}
                      onCheckedChange={(checked) => toggle(item, checked === true)}
                    />
                  )}
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="text-sm font-medium tabular-nums">{item.number}</span>
                    <span className="truncate text-xs text-muted-foreground tabular-nums">
                      {item.policyNumber} · {item.payerName ?? PAYER_LABEL[item.payerType]}
                      {item.statementNumber && ` · ${item.statementNumber}`} · due{" "}
                      {formatPlainDate(item.dueOn)}
                    </span>
                  </span>
                  <Amount value={item.balance} className="w-24 text-right text-sm" />
                  {payment && (
                    <Input
                      aria-label={`Amount for ${item.number}`}
                      inputMode="decimal"
                      className="h-8 w-28 text-right tabular-nums"
                      disabled={!on}
                      value={amounts[item.invoiceId] ?? ""}
                      onChange={(e) =>
                        setAmounts((c) => ({ ...c, [item.invoiceId]: e.target.value }))
                      }
                    />
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setWritingOff(item)}>
                    Write off
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      {credits.length > 0 && (
        <Panel
          flush
          title="Credits"
          description="Credit balances the payer can use or be paid back."
        >
          <ul className="m-0 list-none divide-y p-0">
            {credits.map((c) => (
              <li key={c.invoiceId} className="flex items-center gap-3 px-(--card-p) py-3">
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="text-sm font-medium tabular-nums">Credit note {c.number}</span>
                  <span className="truncate text-xs text-muted-foreground tabular-nums">
                    {c.policyNumber} · {c.payerName ?? PAYER_LABEL[c.payerType]}
                  </span>
                </span>
                <Amount
                  value={{ ...c.balance, amount: String(Math.abs(Number(c.balance.amount))) }}
                  className="text-sm"
                />
                <Button size="sm" variant="outline" onClick={() => setCrediting(c)}>
                  Apply credit
                </Button>
                <Button size="sm" variant="outline" onClick={() => setRefunding(c)}>
                  Refund
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <WriteOffDialog item={writingOff} onOpenChange={(open) => !open && setWritingOff(null)} />
      <ApplyCreditDialog
        credit={crediting}
        invoices={invoices.filter(
          (i) =>
            !crediting ||
            all.find((x) => x.invoiceId === crediting.invoiceId)?.policyId === i.policyId,
        )}
        onOpenChange={(open) => !open && setCrediting(null)}
      />
      {refunding && (
        <RefundDialog
          open
          onOpenChange={(open) => !open && setRefunding(null)}
          source={{ kind: "credit_balance", invoiceId: refunding.invoiceId }}
          label={`the credit on ${refunding.number}`}
          available={{
            ...refunding.balance,
            amount: String(Math.abs(Number(refunding.balance.amount))),
          }}
          card={false}
        />
      )}
    </div>
  );
}
