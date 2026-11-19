import type { AppOutputs } from "@pas/api-client";
import { Button } from "@pas/ui/components/button";
import { EmptyState } from "@pas/ui/components/empty-state";
import { Panel } from "@pas/ui/components/panel";
import { PdfPreview } from "@pas/ui/components/pdf-preview";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@pas/ui/components/sheet";
import { StatusChip, type StatusTone } from "@pas/ui/components/status-chip";
import { useQuery } from "@tanstack/react-query";
import { Download, ReceiptText } from "lucide-react";
import { useMemo, useState } from "react";
import { formatMoney, formatPlainDate } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";

type Statement = AppOutputs["agency"]["statements"][number];

const STATUS: Record<string, { label: string; tone: StatusTone }> = {
  open: { label: "Open", tone: "neutral" },
  partially_paid: { label: "Partially paid", tone: "warning" },
  paid: { label: "Paid", tone: "success" },
  past_due: { label: "Past due", tone: "danger" },
  credit: { label: "Credit", tone: "neutral" },
};

const fromBase64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
const money = (value: { amount: string; currency: string }) => formatMoney(value, { cents: true });

export function StatementStatus({ status }: { status: string }) {
  const { label, tone } = STATUS[status] ?? { label: status, tone: "neutral" as const };

  return <StatusChip tone={tone}>{label}</StatusChip>;
}

/** An agency admin's account current statements (PLAN §13). */
export function AgencyStatements() {
  const trpc = useTRPC();
  const statements = useQuery(trpc.agency.statements.queryOptions({}));
  const [open, setOpen] = useState<string | null>(null);
  const selected = statements.data?.find((s) => s.id === open);

  if (statements.data?.length === 0) return null;

  return (
    <Panel title="Statements" description="Account current for agency-billed policies." flush>
      <ul className="m-0 list-none divide-y p-0">
        {!statements.data && (
          <li className="px-(--card-p) py-3.5">
            <div className="h-5 w-64 animate-pulse rounded bg-muted" />
          </li>
        )}
        {statements.data?.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => setOpen(s.id)}
              className="flex w-full items-center gap-4 px-(--card-p) py-3.5 text-left outline-none hover:bg-muted/40 focus-visible:bg-muted/40"
            >
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="text-sm leading-5 font-medium tabular-nums">
                  {s.number} · {s.agencyName}
                </span>
                <span className="truncate text-xs text-muted-foreground tabular-nums">
                  {formatPlainDate(s.periodStart)} – {formatPlainDate(s.periodEnd)} · due{" "}
                  {formatPlainDate(s.dueOn)}
                </span>
              </span>
              <StatementStatus status={s.status} />
              <span className="w-28 text-right text-sm font-medium tabular-nums">
                {money(s.totals.balance.amount === "0" ? s.totals.due : s.totals.balance)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <StatementSheet statement={selected} onOpenChange={(next) => !next && setOpen(null)} />
    </Panel>
  );
}

function StatementSheet({
  statement,
  onOpenChange,
}: {
  statement: Statement | undefined;
  onOpenChange: (open: boolean) => void;
}) {
  const trpc = useTRPC();

  const document = useQuery({
    ...trpc.agency.statementDocument.queryOptions({ id: statement?.id ?? "" }),
    enabled: Boolean(statement?.hasDocument),
  });

  const pdf = useMemo(
    () => (document.data ? fromBase64(document.data.pdf) : null),
    [document.data],
  );

  function download() {
    if (!pdf || !document.data) return;

    const url = URL.createObjectURL(new Blob([pdf.slice()], { type: "application/pdf" }));
    const link = window.document.createElement("a");
    link.href = url;
    link.download = document.data.fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <Sheet open={statement !== undefined} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl">
        {statement && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-3 tabular-nums">
                Account current {statement.number}
                <StatementStatus status={statement.status} />
              </SheetTitle>
              <SheetDescription className="tabular-nums">
                {statement.agencyName} · {formatPlainDate(statement.periodStart)} –{" "}
                {formatPlainDate(statement.periodEnd)} · due {formatPlainDate(statement.dueOn)}
              </SheetDescription>
            </SheetHeader>
            <SheetBody className="grid gap-6">
              <dl className="m-0 grid grid-cols-2 gap-4 sm:grid-cols-4">
                {(
                  [
                    ["Gross", statement.totals.gross],
                    ["Commission", statement.totals.commission],
                    [statement.remittanceBasis === "net" ? "Net due" : "Due", statement.totals.due],
                    ["Balance", statement.totals.balance],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="grid gap-1">
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="m-0 text-base font-semibold tabular-nums">{money(value)}</dd>
                  </div>
                ))}
              </dl>
              <StatementItems statement={statement} />
              {statement.hasDocument ? (
                <div className="grid gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Statement PDF</span>
                    <Button size="sm" variant="outline" onClick={download} disabled={!pdf}>
                      <Download /> Download
                    </Button>
                  </div>
                  <PdfPreview data={pdf} label={`Account current ${statement.number}`} />
                </div>
              ) : (
                <EmptyState icon={<ReceiptText />} title="The PDF is being prepared" />
              )}
            </SheetBody>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function StatementItems({ statement }: { statement: Statement }) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="h-9 text-left text-xs text-muted-foreground">
          <th className="font-medium">Policy</th>
          <th className="text-right font-medium">Gross</th>
          <th className="text-right font-medium">Commission</th>
          <th className="text-right font-medium">Due</th>
          <th className="text-right font-medium">Open</th>
        </tr>
      </thead>
      <tbody>
        {statement.items.map((item) => (
          <tr key={item.id} className="h-12 border-t">
            <td>
              <span className="block font-medium tabular-nums">{item.policyNumber}</span>
              <span className="block text-xs text-muted-foreground">
                {item.insuredName} · {item.transactionType.replaceAll("_", " ").toLowerCase()}
              </span>
            </td>
            <td className="text-right tabular-nums">{money(item.gross)}</td>
            <td className="text-right tabular-nums">{money(item.commission)}</td>
            <td className="text-right tabular-nums">{money(item.due)}</td>
            <td className="text-right tabular-nums">
              {Number(item.open.amount) === 0 ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                money(item.open)
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
