import type { AdminOutputs } from "@pas/api-client";
import { EmptyState } from "@pas/ui/components/empty-state";
import { Panel } from "@pas/ui/components/panel";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@pas/ui/components/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pas/ui/components/table";
import { useQuery } from "@tanstack/react-query";
import { BookOpen } from "lucide-react";
import { formatDateTime, formatPlainDate } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";
import { Amount } from "./shared";

export type Entry = AdminOutputs["ledger"]["entry"];

const KIND_LABEL: Record<string, string> = {
  invoice_issued: "Invoice",
  credit_note_issued: "Credit note",
  opening_balance: "Opening balance",
  payment_received: "Payment",
  payment_applied: "Application",
  payment_unapplied: "Unapplied",
  payment_reversed: "Reversal",
  refund_issued: "Refund",
  refund_check_issued: "Refund check",
  write_off: "Write-off",
  credit_applied: "Credit",
  invoice_adjusted: "Adjustment",
  commission: "Commission",
  statement_settlement: "Settlement",
  deposit: "Deposit",
};

export const kindLabel = (kind: string) =>
  KIND_LABEL[kind] ?? KIND_LABEL[kind.replace(/\.reversed$/, "")] ?? kind.replaceAll("_", " ");

/** Journal entries newest first; rows open the entry with its lines. */
export function EntriesTable({
  entries,
  onOpen,
  title,
  description,
}: {
  entries: readonly Entry[] | undefined;
  onOpen: (id: string) => void;
  title?: string;
  description?: string;
}) {
  return (
    <Panel flush {...(title && { title })} {...(description && { description })}>
      {entries?.length === 0 ? (
        <EmptyState icon={<BookOpen />} title="No journal entries yet" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Entry</TableHead>
              <TableHead>Effective</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Memo</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>By</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries?.map((e) => (
              <TableRow
                key={e.id}
                className="cursor-pointer hover:bg-muted/40"
                onClick={() => onOpen(e.id)}
              >
                <TableCell className="font-medium tabular-nums">JE-{e.number}</TableCell>
                <TableCell className="tabular-nums">{formatPlainDate(e.effectiveOn)}</TableCell>
                <TableCell className="text-muted-foreground">{kindLabel(e.kind)}</TableCell>
                <TableCell className="max-w-96 truncate">
                  {e.memo}
                  {e.reversedById && <span className="text-muted-foreground"> · reversed</span>}
                </TableCell>
                <TableCell className="text-right">
                  <Amount value={e.total} />
                </TableCell>
                <TableCell className="max-w-32 truncate text-muted-foreground">
                  {e.actor.name}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}

export function EntrySheet({
  entryId,
  onOpen,
  onOpenChange,
}: {
  entryId: string | null;
  onOpen: (id: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const trpc = useTRPC();

  const entry = useQuery({
    ...trpc.ledger.entry.queryOptions({ id: entryId ?? "" }),
    enabled: Boolean(entryId),
  });

  const e = entry.data;

  return (
    <Sheet open={entryId !== null} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl">
        {e && (
          <>
            <SheetHeader>
              <SheetTitle className="tabular-nums">
                JE-{e.number}: {kindLabel(e.kind)}
              </SheetTitle>
              <SheetDescription>{e.memo}</SheetDescription>
            </SheetHeader>
            <SheetBody>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="h-9 text-left text-xs text-muted-foreground">
                    <th className="font-medium">Account</th>
                    <th className="font-medium">For</th>
                    <th className="text-right font-medium">Debit</th>
                    <th className="text-right font-medium">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {e.lines.map((line, index) => (
                    <tr key={index} className="h-11 border-t align-middle">
                      <td>
                        <span className="tabular-nums">{line.account}</span>{" "}
                        <span className="text-muted-foreground">{line.accountName}</span>
                      </td>
                      <td className="text-xs text-muted-foreground tabular-nums">
                        {[
                          line.invoiceNumber,
                          line.jurisdiction,
                          line.payerType && line.payerRef
                            ? `${line.payerType} ${line.payerRef.slice(0, 8)}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </td>
                      <td className="text-right">
                        <Amount value={line.debit} />
                      </td>
                      <td className="text-right">
                        <Amount value={line.credit} />
                      </td>
                    </tr>
                  ))}
                  <tr className="h-11 border-t font-medium">
                    <td colSpan={2}>Total</td>
                    <td className="text-right">
                      <Amount value={e.total} />
                    </td>
                    <td className="text-right">
                      <Amount value={e.total} />
                    </td>
                  </tr>
                </tbody>
              </table>
              <dl className="m-0 grid gap-1.5 border-t pt-4 text-sm">
                <Meta label="Effective">{formatPlainDate(e.effectiveOn)}</Meta>
                <Meta label="Recorded">{formatDateTime(e.recordedAt)}</Meta>
                <Meta label="By">{e.actor.name}</Meta>
                <Meta label="Idempotency key">
                  <code className="text-xs">{e.idempotencyKey}</code>
                </Meta>
                {e.billingEventId && (
                  <Meta label="Billing event">
                    <code className="text-xs">{e.billingEventId}</code>
                  </Meta>
                )}
                {e.reversesId && (
                  <Meta label="Reverses">
                    <button
                      type="button"
                      className="font-medium text-primary hover:underline"
                      onClick={() => onOpen(e.reversesId!)}
                    >
                      Original entry
                    </button>
                  </Meta>
                )}
                {e.reversedById && (
                  <Meta label="Reversed by">
                    <button
                      type="button"
                      className="font-medium text-primary hover:underline"
                      onClick={() => onOpen(e.reversedById!)}
                    >
                      Reversing entry
                    </button>
                  </Meta>
                )}
              </dl>
            </SheetBody>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 text-muted-foreground">
      <dt>{label}</dt>
      <dd className="m-0 truncate text-right text-foreground">{children}</dd>
    </div>
  );
}
