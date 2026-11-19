import type { DocumentContext, DocumentTemplate, SelectedCoverage } from "@pas/documents";
import { renderPdf } from "@pas/documents/render";
import type { TenantContext } from "@pas/kernel";
import type {
  BillingDocuments,
  MortgageePacketDocument,
  StatementDocument,
} from "../ports/billing-documents";

type Branding = DocumentContext["tenant"];

/** What the lender's packet shows about the policy (evidence of insurance, declarations). */
export interface PacketPolicy {
  policyNumber: string;
  productName: string;
  productVersion: string;
  effectiveDate: string;
  expirationDate: string;
  jurisdiction: { country: string; subdivision?: string };
  insuredName: string;
  mailingAddress: unknown;
  insuredLocations: unknown[];
  producer: { name: string; agency?: string };
  coverages: {
    code: string;
    name: string;
    limit?: unknown;
    deductible?: unknown;
    premium: { amount: string; currency: string };
  }[];
  total: { amount: string; currency: string };
}

const page = { size: "letter", margins: "normal" } as const;

const STATEMENT: DocumentTemplate = {
  key: "builtin-account-current",
  title: "Account current",
  kind: "letter",
  page,
  blocks: [
    {
      id: "header",
      type: "header",
      title: "Account current {{risk.number}}",
      subtitle: "{{risk.agency}}",
    },
    {
      id: "facts",
      type: "keyValue",
      columns: 2,
      rows: [
        { label: "Agency", value: "{{risk.agency}}" },
        { label: "Agency address", value: "{{risk.agencyAddress}}" },
        { label: "Statement period", value: "{{risk.period}}" },
        { label: "Statement date", value: "{{risk.issuedOn}}" },
        { label: "Remittance", value: "{{risk.basis}}" },
        { label: "Remit by", value: "{{risk.dueOn}}" },
      ],
    },
    {
      id: "items",
      type: "exposureTable",
      title: "Agency-billed transactions",
      path: "items",
      columns: [
        { label: "Policy · insured", path: "policy" },
        { label: "Transaction", path: "transaction" },
        { label: "Effective", path: "effective" },
        { label: "Gross", path: "gross" },
        { label: "Commission", path: "commission" },
        { label: "Net", path: "net" },
      ],
    },
    {
      id: "totals",
      type: "keyValue",
      title: "Totals",
      columns: 2,
      rows: [
        { label: "Gross premium", value: "{{risk.totals.gross}}" },
        { label: "Commission", value: "{{risk.totals.commission}}" },
        { label: "Net", value: "{{risk.totals.net}}" },
        { label: "Amount due", value: "{{risk.totals.due}}" },
      ],
    },
    {
      id: "remit",
      type: "notice",
      title: "Remittance",
      body: "Remit {{risk.totals.due}} by {{risk.dueOn}} referencing statement {{risk.number}}. Returns and cancellations are netted on this statement. Questions go to {{tenant.name}}.",
    },
  ],
};

const PACKET: DocumentTemplate = {
  key: "builtin-mortgagee-packet",
  title: "Mortgagee invoice packet",
  kind: "letter",
  page,
  blocks: [
    {
      id: "invoice-header",
      type: "header",
      title: "{{risk.title}}",
      subtitle: "Policy {{policy.number}}",
    },
    {
      id: "invoice",
      type: "keyValue",
      columns: 2,
      rows: [
        { label: "Bill to", value: "{{risk.lender}}" },
        { label: "Lender address", value: "{{risk.lenderAddress}}" },
        { label: "Loan number", value: "{{risk.loanNumber}}" },
        { label: "Borrower (named insured)", value: "{{namedInsured.name}}" },
        { label: "Invoice", value: "{{risk.invoiceNumber}}" },
        { label: "Invoice date", value: "{{risk.issuedOn}}" },
        { label: "Amount due", value: "{{risk.amountDue}}" },
        { label: "Due by", value: "{{risk.dueOn}}" },
      ],
    },
    {
      id: "invoice-text",
      type: "text",
      body: "Please remit {{risk.amountDue}} for the annual premium on policy {{policy.number}} by {{risk.dueOn}}, referencing invoice {{risk.invoiceNumber}} and loan {{risk.loanNumber}}. Coverage is in force while payment is pending.",
    },
    { id: "eoi-break", type: "pageBreak" },
    {
      id: "eoi-header",
      type: "header",
      title: "Evidence of insurance",
      subtitle: "Policy {{policy.number}}",
    },
    {
      id: "eoi",
      type: "keyValue",
      columns: 2,
      rows: [
        { label: "Named insured", value: "{{namedInsured.name}}" },
        { label: "Mailing address", value: "{{namedInsured.mailingAddress}}" },
        { label: "Insured property", value: "{{risk.propertyAddress}}" },
        { label: "Policy period", value: "{{policy.effectiveDate}} – {{policy.expirationDate}}" },
        { label: "Mortgagee", value: "{{risk.lender}}, its successors and/or assigns" },
        { label: "Loan number", value: "{{risk.loanNumber}}" },
      ],
    },
    {
      id: "eoi-coverages",
      type: "coverageSchedule",
      title: "Coverages",
      limit: true,
      deductible: true,
      premium: false,
    },
    { id: "dec-break", type: "pageBreak" },
    {
      id: "dec-header",
      type: "header",
      title: "Declarations",
      subtitle: "Policy {{policy.number}}",
    },
    {
      id: "dec",
      type: "keyValue",
      columns: 2,
      rows: [
        { label: "Named insured", value: "{{namedInsured.name}}" },
        { label: "Product", value: "{{product.name}} {{product.version}}" },
        { label: "Policy period", value: "{{policy.effectiveDate}} – {{policy.expirationDate}}" },
        { label: "State", value: "{{policy.jurisdiction}}" },
        { label: "Producer", value: "{{producer.name}}" },
        { label: "Total premium", value: "{{premium.total}}" },
      ],
    },
    {
      id: "dec-coverages",
      type: "coverageSchedule",
      title: "Coverage schedule",
      limit: true,
      deductible: true,
      premium: true,
    },
  ],
};

const longDate = (iso: string) =>
  Temporal.PlainDate.from(iso).toLocaleString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

const today = (iso: string) => ({
  number: "",
  effectiveDate: iso,
  expirationDate: iso,
  issuedDate: iso,
  jurisdiction: { country: "US" },
  jurisdictionName: "",
  transaction: "new_business" as const,
});

/** Billing's documents (account current, lender packet) on the documents engine's blocks. */
export class ReactPdfBillingDocuments implements BillingDocuments {
  constructor(
    private readonly deps: {
      branding: (ctx: TenantContext) => Promise<Branding>;
      policy: (ctx: TenantContext, policyId: string) => Promise<PacketPolicy>;
      jurisdictionName: (jurisdiction: { country: string; subdivision?: string }) => string;
    },
  ) {}

  async statement(ctx: TenantContext, input: StatementDocument): Promise<Uint8Array> {
    const context: DocumentContext = {
      tenant: await this.deps.branding(ctx),
      product: { name: "Agency bill", version: "" },
      policy: today(input.issuedOn),
      namedInsured: { name: input.agency.name },
      risk: {
        number: input.number,
        agency: input.agency.name,
        agencyAddress: input.agency.address ?? "",
        period: `${longDate(input.periodStart)} – ${longDate(input.periodEnd)}`,
        issuedOn: longDate(input.issuedOn),
        dueOn: longDate(input.dueOn),
        basis: input.remittanceBasis === "net" ? "Net of commission" : "Gross",
        items: input.items.map((i) => ({
          policy: `${i.policyNumber} · ${i.insuredName}`,
          transaction: i.transaction,
          effective: longDate(i.effectiveDate),
          gross: i.gross,
          commission: i.commission,
          net: i.net,
        })),
        totals: input.totals,
      },
      coverages: [],
      forms: [],
    };

    return renderPdf({ template: STATEMENT, context, clauses: [], schema: { fields: [] } });
  }

  async mortgageePacket(ctx: TenantContext, input: MortgageePacketDocument): Promise<Uint8Array> {
    const policy = await this.deps.policy(ctx, input.policyId);

    const context: DocumentContext = {
      tenant: await this.deps.branding(ctx),
      product: { name: policy.productName, version: policy.productVersion },
      policy: {
        number: policy.policyNumber,
        effectiveDate: policy.effectiveDate,
        expirationDate: policy.expirationDate,
        issuedDate: input.invoice.issuedOn,
        jurisdiction: policy.jurisdiction,
        jurisdictionName: this.deps.jurisdictionName(policy.jurisdiction),
        transaction: "new_business",
      },
      namedInsured: {
        name: policy.insuredName,
        ...(policy.mailingAddress ? { mailingAddress: policy.mailingAddress as never } : {}),
      },
      producer: policy.producer,
      risk: {
        title: input.title,
        lender: input.lender.name,
        lenderAddress: input.lender.address ?? "",
        loanNumber: input.lender.loanNumber ?? "—",
        invoiceNumber: input.invoice.number,
        issuedOn: longDate(input.invoice.issuedOn),
        dueOn: longDate(input.invoice.dueOn),
        amountDue: input.invoice.total,
        propertyAddress: policy.insuredLocations[0] ?? "",
      },
      coverages: policy.coverages as SelectedCoverage[],
      premium: { total: policy.total },
      forms: [],
    };

    return renderPdf({ template: PACKET, context, clauses: [], schema: { fields: [] } });
  }
}
