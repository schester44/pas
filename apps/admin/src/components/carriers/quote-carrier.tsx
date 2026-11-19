import { Panel } from "@pas/ui/components/panel";
import { StatusChip } from "@pas/ui/components/status-chip";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { StaffQuote } from "@/components/submissions/quote";
import { formatMoney } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";
import { capabilityLabel, RUN_TONES, runLabel } from "./labels";

const STATUS = {
  pending_carrier: { label: "Pending carrier", tone: "accent" },
  quoted: { label: "Carrier quoted", tone: "success" },
  referred: { label: "Carrier referred", tone: "warning" },
  declined: { label: "Carrier declined", tone: "danger" },
  failed: { label: "Carrier failed", tone: "danger" },
} as const;

/** The carrier's quote, how its figures moved ours, and every carrier conversation about it. */
export function QuoteCarrierPanel({ quote }: { quote: StaffQuote }) {
  const trpc = useTRPC();
  const carrier = quote.carrier;

  const runs = useQuery({
    ...trpc.carriers.runs.forQuote.queryOptions({ quoteId: quote.id }),
    enabled: !!carrier,
    refetchInterval:
      carrier?.status === "pending_carrier" || carrier?.bind?.status === "pending_carrier"
        ? 2000
        : false,
  });

  const carriers = useQuery({ ...trpc.carriers.list.queryOptions(), enabled: !!carrier });
  const carrierId = carriers.data?.find((c) => c.key === carrier?.carrier)?.id;

  if (!carrier) return null;

  const status =
    carrier.bind?.status === "pending_carrier" ? STATUS.pending_carrier : STATUS[carrier.status];

  const diff = carrier.diff;

  const fmt = (amount: string | null) =>
    amount === null || !diff ? "–" : formatMoney({ amount, currency: diff.currency });

  return (
    <Panel
      flush
      title={carrier.name}
      description={
        carrier.bind?.status === "pending_carrier"
          ? `With the carrier to ${carrier.bind.phase}`
          : carrier.figuresWin
            ? "Carrier figures win: its premium, taxes and fees replace ours."
            : "PAS rates; the carrier confirms."
      }
      action={<StatusChip tone={status.tone}>{status.label}</StatusChip>}
    >
      {carrier.messages.length > 0 && (
        <p className="m-0 border-b px-(--card-p) py-3 text-sm text-muted-foreground">
          {carrier.messages.map((m) => m.text).join(" ")}
        </p>
      )}
      {carrier.bind?.status === "failed" && (
        <p className="m-0 border-b px-(--card-p) py-3 text-sm text-red-800">
          Bind failed: {carrier.bind.message}
        </p>
      )}
      {diff && diff.changes.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="h-10 bg-muted/40 text-xs text-muted-foreground">
              <th className="pl-(--card-p) text-left font-medium">Line</th>
              <th className="px-3 text-right font-medium">Our rating</th>
              <th className="px-3 text-right font-medium">Carrier</th>
              <th className="pr-(--card-p) text-right font-medium">Change</th>
            </tr>
          </thead>
          <tbody>
            {diff.changes.map((c) => (
              <tr key={c.key} className="h-11 border-t">
                <td className="pl-(--card-p)">{c.label}</td>
                <td className="px-3 text-right tabular-nums">{fmt(c.pas)}</td>
                <td className="px-3 text-right tabular-nums">{fmt(c.carrier)}</td>
                <td className="pr-(--card-p) text-right tabular-nums">{fmt(c.difference)}</td>
              </tr>
            ))}
            <tr className="h-11 border-t font-semibold">
              <td className="pl-(--card-p)">Total</td>
              <td className="px-3 text-right tabular-nums">{fmt(diff.pasTotal)}</td>
              <td className="px-3 text-right tabular-nums">{fmt(diff.carrierTotal)}</td>
              <td className="pr-(--card-p) text-right tabular-nums">{fmt(diff.difference)}</td>
            </tr>
          </tbody>
        </table>
      )}
      {(runs.data ?? []).length > 0 && (
        <ul className="m-0 list-none divide-y border-t p-0">
          {(runs.data ?? []).map((run) => (
            <li key={run.id} className="flex items-center gap-3 px-(--card-p) py-2.5 text-sm">
              <span className="flex-1">
                {capabilityLabel(run.capability)}
                {run.output?.outcome.reference && (
                  <span className="text-muted-foreground"> · {run.output.outcome.reference}</span>
                )}
              </span>
              <StatusChip tone={RUN_TONES[run.status] ?? "neutral"}>
                {runLabel(run.status)}
              </StatusChip>
              {carrierId && (
                <Link
                  to="/carriers/$carrierId/console"
                  params={{ carrierId }}
                  search={{ run: run.id }}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Exchanges
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
