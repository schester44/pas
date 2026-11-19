import type { EventSubject, PublicEventType } from "../domain/event-types";
import type {
  EventData,
  InvoiceSnapshot,
  MoneyValue,
  ObligationSnapshot,
  PolicySnapshot,
  QuoteSnapshot,
  SubmissionSnapshot,
  TransactionSnapshot,
} from "./payloads";

export interface CatalogEntry<T extends PublicEventType = PublicEventType> {
  type: T;
  title: string;
  description: string;
  sample: EventData<T>;
  subject(data: EventData<T>): EventSubject;
  producerId(data: EventData<T>): string | null;
  facets(data: EventData<T>): Record<string, unknown>;
  message(data: EventData<T>): { title: string; body: string };
}

export const formatMoney = (value: MoneyValue | null) =>
  value
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: value.currency }).format(
        Number(value.amount),
      )
    : "";

const formatDate = (iso: string) =>
  Temporal.PlainDate.from(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

const amount = (value: MoneyValue | null) => (value ? Number(value.amount) : null);

const jurisdictionCode = (j: { country: string; subdivision: string | null }) =>
  j.subdivision ?? j.country;

const join = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(" · ");

function quoteFacets(data: { submission: SubmissionSnapshot; quote: QuoteSnapshot }) {
  return {
    product: data.submission.product.key,
    jurisdiction: jurisdictionCode(data.submission.jurisdiction),
    producer: data.submission.producer.id,
    premium: amount(data.quote.premium.total),
    data,
  };
}

function policyFacets(data: { policy: PolicySnapshot }, extra: Record<string, unknown> = {}) {
  return {
    product: data.policy.product.key,
    jurisdiction: jurisdictionCode(data.policy.jurisdiction),
    producer: data.policy.producer.id,
    agency: data.policy.agency?.id ?? null,
    premium: amount(data.policy.writtenPremium),
    ...extra,
    data,
  };
}

const submissionSubject = (data: { submission: SubmissionSnapshot }): EventSubject => ({
  kind: "submission",
  id: data.submission.id,
});

const policySubject = (data: { policy: PolicySnapshot }): EventSubject => ({
  kind: "policy",
  id: data.policy.id,
});

const quoteLine = (data: { submission: SubmissionSnapshot; quote: QuoteSnapshot }) =>
  join(
    data.submission.insuredName,
    data.submission.product.name,
    formatMoney(data.quote.premium.total),
  );

const policyLine = (policy: PolicySnapshot) =>
  join(policy.insuredName, policy.product.name, formatMoney(policy.writtenPremium));

const sampleSubmission: SubmissionSnapshot = {
  id: "0199a3f0-1c2d-7e4f-8a1b-2c3d4e5f6a7b",
  number: "S-1042",
  status: "submitted",
  product: { id: "0199a3ef-0000-7000-8000-000000000001", key: "homeowners", name: "Homeowners" },
  jurisdiction: { country: "US", subdivision: "US-FL" },
  effectiveDate: "2027-01-01",
  insuredName: "Jane Doe",
  producer: { id: "u_8f2kq1", name: "Morgan Lee" },
};

const sampleQuote: QuoteSnapshot = {
  id: "0199a3f0-2b3c-7d4e-9f0a-1b2c3d4e5f60",
  status: "quoted",
  premium: {
    written: { amount: "6120.00", currency: "USD" },
    total: { amount: "6387.50", currency: "USD" },
  },
  expiresAt: "2026-12-18T05:00:00Z",
  referralReasons: [],
};

const samplePolicy: PolicySnapshot = {
  id: "0199a3f1-4d5e-7f60-8a1b-2c3d4e5f6a7c",
  number: "HO-2027-000184",
  status: "pending_effective",
  product: sampleSubmission.product,
  jurisdiction: sampleSubmission.jurisdiction,
  insuredName: "Jane Doe",
  producer: sampleSubmission.producer,
  agency: { id: "0199a3e0-aaaa-7bbb-8ccc-dddddddddddd", name: "Coastal Insurance Group" },
  effectiveDate: "2027-01-01",
  expirationDate: "2028-01-01",
  writtenPremium: { amount: "6120.00", currency: "USD" },
  total: { amount: "6387.50", currency: "USD" },
};

const sampleTransaction = (type: TransactionSnapshot["type"]): TransactionSnapshot => ({
  id: "0199a3f1-5e6f-7a0b-8c1d-2e3f4a5b6c7d",
  type,
  effectiveDate: type === "NEW_BUSINESS" ? "2027-01-01" : "2027-04-15",
});

const sampleInvoice: InvoiceSnapshot = {
  id: "0199a3f1-6f70-7b1c-8d2e-3f4a5b6c7d8e",
  number: "INV-000312",
  kind: "invoice",
  status: "open",
  issuedOn: "2026-12-01",
  dueOn: "2027-01-01",
  total: { amount: "1596.88", currency: "USD" },
  balance: { amount: "1596.88", currency: "USD" },
  installment: { number: 1, of: 4 },
};

const sampleObligation: ObligationSnapshot = {
  id: "0199a3f2-7a8b-7c9d-8e0f-1a2b3c4d5e6f",
  kind: "sl_filing",
  title: "Surplus lines filing",
  status: "pending",
  jurisdiction: "US-FL",
  dueDate: "2027-02-14",
  policy: { id: samplePolicy.id, number: samplePolicy.number },
};

const transactionEntry = <
  T extends
    | "policy.issued"
    | "policy.endorsed"
    | "policy.cancellation_rescinded"
    | "policy.cancelled"
    | "policy.reinstated",
>(
  type: T,
  title: string,
  description: string,
  sampleType: TransactionSnapshot["type"],
  verb: string,
): CatalogEntry<T> => {
  const entry: Omit<CatalogEntry<"policy.issued">, "type"> = {
    title,
    description,
    sample: { policy: samplePolicy, transaction: sampleTransaction(sampleType) },
    subject: policySubject,
    producerId: (data) => data.policy.producer.id,
    facets: (data) => policyFacets(data, { transactionType: data.transaction.type }),
    message: (data) => ({
      title: `${data.policy.number} ${verb}`,
      body: join(
        policyLine(data.policy),
        `effective ${formatDate(data.transaction.effectiveDate)}`,
      ),
    }),
  };

  return { ...entry, type } as unknown as CatalogEntry<T>;
};

const entries: { [T in PublicEventType]: CatalogEntry<T> } = {
  "submission.submitted": {
    type: "submission.submitted",
    title: "Submission submitted",
    description: "A submission was completed and sent for quoting.",
    sample: { submission: sampleSubmission },
    subject: submissionSubject,
    producerId: (data) => data.submission.producer.id,
    facets: (data) => ({
      product: data.submission.product.key,
      jurisdiction: jurisdictionCode(data.submission.jurisdiction),
      producer: data.submission.producer.id,
      data,
    }),
    message: (data) => ({
      title: `Submission ${data.submission.number} submitted`,
      body: join(data.submission.insuredName, data.submission.product.name),
    }),
  },
  "quote.referred": {
    type: "quote.referred",
    title: "Quote referred",
    description: "Underwriting rules referred a quote to an underwriter before it can be bound.",
    sample: {
      submission: sampleSubmission,
      quote: {
        ...sampleQuote,
        status: "referred",
        referralReasons: [{ code: "TIV_OVER_AUTHORITY", message: "TIV exceeds $1M" }],
      },
    },
    subject: submissionSubject,
    producerId: (data) => data.submission.producer.id,
    facets: quoteFacets,
    message: (data) => ({
      title: `Quote ${data.submission.number} referred`,
      body: join(
        quoteLine(data),
        data.quote.referralReasons.map((r) => r.message).join("; ") || null,
      ),
    }),
  },
  "quote.approved": {
    type: "quote.approved",
    title: "Quote approved",
    description: "An underwriter approved a referred quote; it can now be bound.",
    sample: {
      submission: sampleSubmission,
      quote: sampleQuote,
      conditions: ["Roof inspection within 30 days"],
    },
    subject: submissionSubject,
    producerId: (data) => data.submission.producer.id,
    facets: quoteFacets,
    message: (data) => ({
      title: `Quote ${data.submission.number} approved`,
      body: join(
        quoteLine(data),
        data.conditions.length > 0 && `Conditions: ${data.conditions.join("; ")}`,
      ),
    }),
  },
  "quote.declined": {
    type: "quote.declined",
    title: "Quote declined",
    description: "A quote was declined by an underwriter or by the underwriting rules.",
    sample: {
      submission: sampleSubmission,
      quote: { ...sampleQuote, status: "declined" },
      declinedBy: "underwriter",
    },
    subject: submissionSubject,
    producerId: (data) => data.submission.producer.id,
    facets: (data) => ({ ...quoteFacets(data), declinedBy: data.declinedBy }),
    message: (data) => ({
      title: `Quote ${data.submission.number} declined`,
      body: join(quoteLine(data), data.declinedBy === "rules" ? "By the rules" : "By underwriting"),
    }),
  },
  "quote.bound": {
    type: "quote.bound",
    title: "Quote bound",
    description: "A quote was bound and its policy number assigned.",
    sample: {
      submission: sampleSubmission,
      quote: { ...sampleQuote, status: "bound" },
      policy: { id: samplePolicy.id, number: samplePolicy.number },
    },
    subject: submissionSubject,
    producerId: (data) => data.submission.producer.id,
    facets: quoteFacets,
    message: (data) => ({
      title: `Quote ${data.submission.number} bound as ${data.policy.number}`,
      body: quoteLine(data),
    }),
  },
  "policy.issued": transactionEntry(
    "policy.issued",
    "Policy issued",
    "New business was issued: the first term and its transaction exist.",
    "NEW_BUSINESS",
    "issued",
  ),
  "policy.endorsed": transactionEntry(
    "policy.endorsed",
    "Policy endorsed",
    "A mid-term change was issued on a policy.",
    "ENDORSEMENT",
    "endorsed",
  ),
  "policy.cancellation_scheduled": {
    type: "policy.cancellation_scheduled",
    title: "Cancellation scheduled",
    description: "A cancellation was issued with a future effective date; notices go out next.",
    sample: {
      policy: { ...samplePolicy, status: "pending_cancellation" },
      cancellation: {
        transactionId: sampleTransaction("CANCELLATION").id,
        effectiveDate: "2027-04-15",
      },
    },
    subject: policySubject,
    producerId: (data) => data.policy.producer.id,
    facets: (data) => policyFacets(data),
    message: (data) => ({
      title: `${data.policy.number} cancellation scheduled`,
      body: join(
        policyLine(data.policy),
        `effective ${formatDate(data.cancellation.effectiveDate)}`,
      ),
    }),
  },
  "policy.cancellation_rescinded": transactionEntry(
    "policy.cancellation_rescinded",
    "Cancellation rescinded",
    "A scheduled cancellation was withdrawn; the policy stays in force.",
    "CANCELLATION_RESCISSION",
    "cancellation rescinded",
  ),
  "policy.cancelled": transactionEntry(
    "policy.cancelled",
    "Policy cancelled",
    "A cancellation was issued and takes effect on its effective date.",
    "CANCELLATION",
    "cancelled",
  ),
  "policy.reinstated": transactionEntry(
    "policy.reinstated",
    "Policy reinstated",
    "A cancelled policy was reinstated.",
    "REINSTATEMENT",
    "reinstated",
  ),
  "invoice.issued": {
    type: "invoice.issued",
    title: "Invoice issued",
    description: "An invoice was issued on a policy, including each installment as it opens.",
    sample: { policy: samplePolicy, invoice: sampleInvoice },
    subject: policySubject,
    producerId: (data) => data.policy.producer.id,
    facets: (data) => policyFacets(data, { amount: amount(data.invoice.total) }),
    message: (data) => ({
      title: `Invoice ${data.invoice.number} issued`,
      body: join(
        data.policy.number,
        formatMoney(data.invoice.total),
        `due ${formatDate(data.invoice.dueOn)}`,
      ),
    }),
  },
  "invoice.past_due": {
    type: "invoice.past_due",
    title: "Invoice past due",
    description: "An invoice passed its due date with a balance left.",
    sample: { policy: samplePolicy, invoice: { ...sampleInvoice, status: "past_due" } },
    subject: policySubject,
    producerId: (data) => data.policy.producer.id,
    facets: (data) => policyFacets(data, { amount: amount(data.invoice.balance) }),
    message: (data) => ({
      title: `Invoice ${data.invoice.number} is past due`,
      body: join(
        data.policy.number,
        `${formatMoney(data.invoice.balance)} was due ${formatDate(data.invoice.dueOn)}`,
      ),
    }),
  },
  "payment.received": {
    type: "payment.received",
    title: "Payment received",
    description: "A payment was applied to an invoice.",
    sample: {
      policy: samplePolicy,
      invoice: { ...sampleInvoice, status: "paid", balance: { amount: "0", currency: "USD" } },
      payment: { amount: sampleInvoice.total },
    },
    subject: policySubject,
    producerId: (data) => data.policy.producer.id,
    facets: (data) => policyFacets(data, { amount: amount(data.payment.amount) }),
    message: (data) => ({
      title: `Payment received for ${data.invoice.number}`,
      body: join(data.policy.number, formatMoney(data.payment.amount)),
    }),
  },
  "payment.failed": {
    type: "payment.failed",
    title: "Payment failed",
    description: "A card or autopay charge for an invoice was declined.",
    sample: {
      policy: samplePolicy,
      invoice: sampleInvoice,
      payment: { amount: sampleInvoice.total, reason: "Your card was declined." },
    },
    subject: policySubject,
    producerId: (data) => data.policy.producer.id,
    facets: (data) => policyFacets(data, { amount: amount(data.payment.amount) }),
    message: (data) => ({
      title: `Payment failed for ${data.policy.number}`,
      body: join(
        data.policy.insuredName,
        data.invoice.number,
        formatMoney(data.payment.amount),
        data.payment.reason,
      ),
    }),
  },
  "obligation.overdue": {
    type: "obligation.overdue",
    title: "Obligation overdue",
    description: "A compliance obligation (filing, notice, report) passed its due date.",
    sample: { obligation: { ...sampleObligation, status: "pending" } },
    subject: (data) => ({ kind: "obligation", id: data.obligation.id }),
    producerId: () => null,
    facets: (data) => ({
      kind: data.obligation.kind,
      jurisdiction: data.obligation.jurisdiction,
      data,
    }),
    message: (data) => ({
      title: `${data.obligation.title} overdue`,
      body: join(
        data.obligation.policy?.number,
        data.obligation.jurisdiction,
        `was due ${formatDate(data.obligation.dueDate)}`,
      ),
    }),
  },
  "filing.rejected": {
    type: "filing.rejected",
    title: "Filing rejected",
    description: "A regulator or stamping office rejected a filing; it needs a correction.",
    sample: {
      obligation: { ...sampleObligation, status: "rejected" },
      filing: { id: "0199a3f2-8b9c-7d0e-8f1a-2b3c4d5e6f70", reasons: ["Missing NAIC code"] },
    },
    subject: (data) => ({ kind: "obligation", id: data.obligation.id }),
    producerId: () => null,
    facets: (data) => ({
      kind: data.obligation.kind,
      jurisdiction: data.obligation.jurisdiction,
      data,
    }),
    message: (data) => ({
      title: `${data.obligation.title} rejected`,
      body: join(data.obligation.policy?.number, data.filing.reasons.join("; ")),
    }),
  },
};

export function catalogEntry<T extends PublicEventType>(type: T): CatalogEntry<T> {
  return entries[type] as CatalogEntry<T>;
}

export const catalogEntries = (): CatalogEntry[] => Object.values(entries) as CatalogEntry[];
