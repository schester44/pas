import type { AdminOutputs } from "@pas/api-client";
import { Button } from "@pas/ui/components/button";
import { Panel } from "@pas/ui/components/panel";
import { SegmentedControl } from "@pas/ui/components/segmented-control";
import { cn } from "@pas/ui/lib/utils";
import {
  Banknote,
  CalendarClock,
  Check,
  CircleAlert,
  FileSignature,
  FileText,
  Gavel,
  Mail,
  Receipt,
  ScrollText,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { humanize } from "@/components/decisions/jdm-edit";
import { formatDate, formatMoney, formatRelative } from "@/lib/format";

type Policy = AdminOutputs["policies"]["get"];
type PolicyEvent = Policy["events"][number];
type Invoice = AdminOutputs["policies"]["billing"]["invoices"][number];

const ICONS: Record<string, typeof Check> = {
  transactional: ScrollText,
  lifecycle: Check,
  underwriting: Gavel,
  billing: Banknote,
  document: FileText,
  communication: Mail,
  compliance: ShieldCheck,
};

const CATEGORY_LABELS: Record<string, string> = {
  transactional: "Transactions",
  lifecycle: "Lifecycle",
  underwriting: "Underwriting",
  billing: "Billing",
  document: "Documents",
  communication: "Notices",
};

const RECENT = 12;

const iconFor = (event: PolicyEvent) =>
  event.type === "signed"
    ? FileSignature
    : event.type === "invoice_issued"
      ? Receipt
      : event.type === "payment_failed" ||
          event.type === "filing_rejected" ||
          event.type === "obligation_overdue"
        ? CircleAlert
        : event.type === "pending_cancellation"
          ? CalendarClock
          : (ICONS[event.category] ?? Check);

const titleOf = (type: string) => {
  const text = type.replaceAll("_", " ").replace(/^uw /, "underwriting ");

  return text.charAt(0).toUpperCase() + text.slice(1);
};

/** The policy's history, newest first; transactional events carry their invoice. */
export function ActivityTimeline({
  policy,
  invoices,
  onOpenInvoice,
}: {
  policy: Policy;
  invoices: readonly Invoice[];
  onOpenInvoice: (invoiceId: string) => void;
}) {
  const [category, setCategory] = useState("all");
  const categories = [...new Set(policy.events.map((e) => e.category))];
  const [expanded, setExpanded] = useState(false);

  const matching =
    category === "all" ? policy.events : policy.events.filter((e) => e.category === category);

  const events = expanded ? matching : matching.slice(0, RECENT);
  const hidden = matching.length - events.length;

  return (
    <Panel flush>
      {categories.length > 1 && (
        <div className="overflow-x-auto border-b px-(--card-p) py-3 [scrollbar-width:none]">
          <SegmentedControl
            label="Filter by category"
            value={category}
            onValueChange={setCategory}
            options={[
              { value: "all", label: "All" },
              ...categories.map((c) => ({ value: c, label: CATEGORY_LABELS[c] ?? humanize(c) })),
            ]}
          />
        </div>
      )}
      <ol className="m-0 grid list-none p-(--card-p)">
        {events.map((event, index) => (
          <TimelineItem
            key={event.id}
            event={event}
            last={index === events.length - 1}
            invoice={invoices.find((i) => i.id === event.invoiceId)}
            onOpenInvoice={onOpenInvoice}
          />
        ))}
      </ol>
      {hidden > 0 && (
        <div className="border-t px-(--card-p) py-3">
          <Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
            Show {hidden} earlier {hidden === 1 ? "event" : "events"}
          </Button>
        </div>
      )}
    </Panel>
  );
}

function TimelineItem({
  event,
  last,
  invoice,
  onOpenInvoice,
}: {
  event: PolicyEvent;
  last: boolean;
  invoice: Invoice | undefined;
  onOpenInvoice: (invoiceId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const icon = iconFor(event);
  const transactional = event.category === "transactional";
  const failed = event.type === "payment_failed" || event.type === "uw_declined";

  return (
    <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3">
      <div className="flex flex-col items-center">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full ring-1 [&_svg]:size-4",
            transactional
              ? "bg-primary text-primary-foreground ring-primary"
              : failed
                ? "bg-red-50 text-red-700 ring-red-200"
                : "bg-background text-muted-foreground ring-border",
          )}
        >
          <EventIcon icon={icon} />
        </span>
        {!last && <span aria-hidden className="w-px flex-1 bg-border" />}
      </div>
      <div className={cn("grid min-w-0 gap-1 pt-1", !last && "pb-6")}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <span className="text-sm font-medium">{titleOf(event.type)}</span>
          <time
            dateTime={event.occurredAt}
            title={new Date(event.occurredAt).toLocaleString()}
            className="text-xs text-muted-foreground tabular-nums"
          >
            {formatRelative(event.occurredAt)}
          </time>
        </div>
        <p className="m-0 text-sm text-muted-foreground">{event.summary}</p>
        {transactional && invoice && (
          <button
            type="button"
            onClick={() => onOpenInvoice(invoice.id)}
            className="flex w-fit items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5 text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <Receipt aria-hidden className="size-3.5 text-muted-foreground" />
            <span className="font-medium tabular-nums">{invoice.number}</span>
            <span className="tabular-nums text-muted-foreground">
              {formatMoney(invoice.total.amount, invoice.total.currency)}
            </span>
          </button>
        )}
        <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
          <span>{event.actor.name}</span>
          {event.effectiveDate && (
            <span className="tabular-nums">
              Effective {formatDate(`${event.effectiveDate}T12:00:00Z`)}
            </span>
          )}
          {Object.keys(event.data).length > 0 && (
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className="font-medium text-foreground/80 underline-offset-4 outline-none hover:underline focus-visible:underline"
            >
              {open ? "Hide details" : "Details"}
            </button>
          )}
        </div>
        {open && (
          <pre className="m-0 mt-1 max-h-64 overflow-auto rounded-lg bg-muted/50 p-3 font-mono text-xs leading-5">
            {JSON.stringify(event.data, null, 2)}
          </pre>
        )}
      </div>
    </li>
  );
}

function EventIcon({ icon: Icon }: { icon: typeof Check }) {
  return <Icon aria-hidden />;
}
