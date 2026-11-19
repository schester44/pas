import { Notice } from "@pas/ui/components/notice";
import { PageBody } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pas/ui/components/select";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { capabilityLabel } from "@/components/carriers/labels";
import { useVersionEditor } from "@/components/catalog/version-editor";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute("/_authed/products/$productId/versions/$versionId/carrier")({
  component: CarrierTab,
});

type Kind = "new_business" | "endorsement" | "cancellation" | "reinstatement";

interface Ownership {
  transactions: Record<Kind, "pas" | "carrier" | "carrier_with_mirror">;
  rating: "pas" | "carrier" | "pas_confirmed";
  lineItems: "pas" | "carrier";
  documents: { source: "tenant" | "carrier" | "both"; order: "tenant_first" | "carrier_first" };
  policyNumber: "pas" | "carrier" | "both";
  billing: "agency_bill" | "direct_bill";
}

const DEFAULT: Ownership = {
  transactions: {
    new_business: "pas",
    endorsement: "pas",
    cancellation: "pas",
    reinstatement: "pas",
  },
  rating: "pas",
  lineItems: "pas",
  documents: { source: "tenant", order: "tenant_first" },
  policyNumber: "pas",
  billing: "agency_bill",
};

const KINDS: { kind: Kind; label: string; capability: string[] }[] = [
  { kind: "new_business", label: "New business (bind and issue)", capability: ["bind", "issue"] },
  { kind: "endorsement", label: "Endorsements", capability: ["endorse"] },
  { kind: "cancellation", label: "Cancellations", capability: ["cancel"] },
  { kind: "reinstatement", label: "Reinstatements", capability: ["reinstate"] },
];

const TRANSACTION_OWNERS = {
  pas: "PAS",
  carrier: "Carrier",
  carrier_with_mirror: "PAS, carrier mirrors by feed",
};

function Choice<T extends string>({
  id,
  value,
  options,
  onChange,
  disabled,
}: {
  id: string;
  value: T;
  options: Record<T, string>;
  onChange: (next: T) => void;
  disabled: boolean;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)} disabled={disabled}>
      <SelectTrigger id={id} className="w-64">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.entries(options) as [T, string][]).map(([v, label]) => (
          <SelectItem key={v} value={v}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Row({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 px-(--card-p) py-3">
      <div className="grid gap-0.5">
        <p className="m-0 text-sm leading-5 font-medium">{label}</p>
        {description && <p className="m-0 text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  );
}

/** Which carrier writes this version and who owns each concern (PLAN §12 ownership matrix). */
function CarrierTab() {
  const trpc = useTRPC();
  const { contents, set, readOnly } = useVersionEditor();
  const carriers = useQuery(trpc.carriers.list.queryOptions());

  const current = (contents.lifecycle.carrier ?? null) as {
    carrier: string;
    ownership?: Partial<Ownership>;
  } | null;

  const ownership: Ownership = {
    ...DEFAULT,
    ...current?.ownership,
    transactions: { ...DEFAULT.transactions, ...current?.ownership?.transactions },
    documents: { ...DEFAULT.documents, ...current?.ownership?.documents },
  };

  const carrier = carriers.data?.find((c) => c.key === current?.carrier);

  const write = (next: { carrier: string; ownership: Ownership } | null) => {
    const { carrier: _old, ...rest } = contents.lifecycle;

    set("lifecycle", next ? { ...rest, carrier: next } : rest);
  };

  const own = (patch: Partial<Ownership>) =>
    current && write({ carrier: current.carrier, ownership: { ...ownership, ...patch } });

  const required = [
    ...(ownership.rating !== "pas" ? ["quote"] : []),
    ...KINDS.filter((k) => ownership.transactions[k.kind] === "carrier").flatMap(
      (k) => k.capability,
    ),
  ];

  const missing = carrier
    ? required.filter((c) => !carrier.connector?.capabilities.includes(c as never))
    : [];

  return (
    <PageBody className="max-w-4xl">
      <Panel
        title="Carrier"
        description="The carrier that writes this version. Without one, PAS is system of record for everything."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Select
            value={current?.carrier ?? "none"}
            disabled={readOnly}
            onValueChange={(key) => write(key === "none" ? null : { carrier: key, ownership })}
          >
            <SelectTrigger className="w-72" aria-label="Carrier">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No carrier</SelectItem>
              {(carriers.data ?? []).map((c) => (
                <SelectItem key={c.key} value={c.key}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {carrier && (
            <Link
              to="/carriers/$carrierId"
              params={{ carrierId: carrier.id }}
              className="text-sm font-medium text-primary hover:underline"
            >
              Open carrier
            </Link>
          )}
        </div>
      </Panel>
      {current && (
        <>
          {missing.length > 0 && (
            <Notice tone="warning" title="The carrier's connector can't do all of this yet">
              {carrier?.name} has no published{" "}
              {missing.map(capabilityLabel).join(", ").toLowerCase()}; publishing this version will
              fail its checks.
            </Notice>
          )}
          <Panel
            flush
            title="Transactions"
            description="Carrier-owned transactions wait in pending carrier until the carrier confirms."
          >
            <div className="divide-y">
              {KINDS.map((k) => (
                <Row key={k.kind} label={k.label}>
                  <Choice
                    id={`owner-${k.kind}`}
                    value={ownership.transactions[k.kind]}
                    options={TRANSACTION_OWNERS}
                    disabled={readOnly}
                    onChange={(v) =>
                      own({ transactions: { ...ownership.transactions, [k.kind]: v } })
                    }
                  />
                </Row>
              ))}
            </div>
          </Panel>
          <Panel flush title="Figures, documents and numbers">
            <div className="divide-y">
              <Row label="Rating" description="Who prices the quote.">
                <Choice
                  id="owner-rating"
                  value={ownership.rating}
                  disabled={readOnly}
                  options={{
                    pas: "PAS rates",
                    carrier: "Carrier rates",
                    pas_confirmed: "PAS rates, carrier confirms",
                  }}
                  onChange={(rating) => own({ rating })}
                />
              </Row>
              <Row
                label="Invoice line items"
                description="Premium, taxes and fees on quotes and changes."
              >
                <Choice
                  id="owner-lines"
                  value={ownership.lineItems}
                  disabled={readOnly}
                  options={{ pas: "PAS computes", carrier: "Carrier figures win" }}
                  onChange={(lineItems) => own({ lineItems })}
                />
              </Row>
              <Row label="Documents">
                <Choice
                  id="owner-docs"
                  value={ownership.documents.source}
                  disabled={readOnly}
                  options={{
                    tenant: "Our templates",
                    carrier: "Carrier documents",
                    both: "Both, merged in one packet",
                  }}
                  onChange={(source) => own({ documents: { ...ownership.documents, source } })}
                />
              </Row>
              {ownership.documents.source === "both" && (
                <Row label="Packet order">
                  <Choice
                    id="owner-order"
                    value={ownership.documents.order}
                    disabled={readOnly}
                    options={{
                      tenant_first: "Ours, then the carrier's",
                      carrier_first: "The carrier's, then ours",
                    }}
                    onChange={(order) => own({ documents: { ...ownership.documents, order } })}
                  />
                </Row>
              )}
              <Row label="Policy number">
                <Choice
                  id="owner-number"
                  value={ownership.policyNumber}
                  disabled={readOnly}
                  options={{ pas: "Ours", carrier: "The carrier's", both: "Both kept" }}
                  onChange={(policyNumber) => own({ policyNumber })}
                />
              </Row>
              <Row label="Billing">
                <Choice
                  id="owner-billing"
                  value={ownership.billing}
                  disabled={readOnly}
                  options={{
                    agency_bill: "Agency bill (PAS invoices)",
                    direct_bill: "Direct bill (carrier invoices)",
                  }}
                  onChange={(billing) => own({ billing })}
                />
              </Row>
            </div>
          </Panel>
        </>
      )}
    </PageBody>
  );
}
