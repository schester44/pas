import {
  AggregateRoot,
  type Clock,
  conflict,
  type DomainEvent,
  type Id,
  type Instant,
  type Jurisdiction,
  type Money,
  newId,
  type PlainDate,
  type TenantId,
} from "@pas/kernel";
import {
  assertLinked,
  categoryOf,
  type PolicyEventProps,
  type PolicyEventType,
  type TimelineActor,
} from "./policy-event";

export type PolicyId = Id<"Policy">;

const TRANSACTION_EVENT: Record<PolicyTransactionProps["type"], PolicyEventType> = {
  NEW_BUSINESS: "new_business",
};

export type PolicyTermId = Id<"PolicyTerm">;
export type TermStatus = "pending_effective" | "in_force" | "expired" | "cancelled";

const TERM_TRANSITIONS: Record<TermStatus, readonly TermStatus[]> = {
  pending_effective: ["in_force", "cancelled"],
  in_force: ["expired", "cancelled"],
  expired: [],
  cancelled: [],
};

export interface PolicyTermProps {
  id: PolicyTermId;
  termNumber: number;
  productReleaseId: string;
  productVersion: string;
  jurisdiction: Jurisdiction;
  effectiveDate: PlainDate;
  expirationDate: PlainDate;
  status: TermStatus;
  writtenPremium: Money;
  taxesAndFees: Money;
  boundAt: Instant;
  activatedAt: Instant | null;
  updatedAt: Instant;
}

export interface PolicyTransactionProps {
  id: string;
  termId: PolicyTermId;
  type: "NEW_BUSINESS";
  status: "issued";
  effectiveDate: PlainDate;
  premiumDelta: Money;
  issuedAt: Instant;
}

export interface TermVersionProps {
  id: string;
  termId: PolicyTermId;
  transactionId: string;
  version: number;
  effectiveDate: PlainDate;
  snapshot: Record<string, unknown>;
  recordedAt: Instant;
}

export interface FinancialTransactionProps {
  id: string;
  termId: PolicyTermId;
  transactionId: string;
  kind: "written_premium" | "tax_fee";
  code: string;
  label: string;
  coverage?: string;
  exposure?: string;
  remitter?: string;
  amount: Money;
  effectiveDate: PlainDate;
  recordedAt: Instant;
}

export interface PolicyDocumentProps {
  id: string;
  transactionId: string;
  kind: string;
  title: string;
  storageKey: string;
  sizeBytes: number;
  createdAt: Instant;
}

export interface PolicyProps {
  id: PolicyId;
  tenantId: TenantId;
  number: string;
  productId: string;
  productName: string;
  insuredName: string;
  producer: { id: string; name: string };
  sourceSubmissionId: string;
  sourceQuoteId: string;
  createdAt: Instant;
}

export interface PolicyState {
  policy: PolicyProps;
  terms: PolicyTermProps[];
  transactions: PolicyTransactionProps[];
  versions: TermVersionProps[];
  financials: FinancialTransactionProps[];
  documents: PolicyDocumentProps[];
  events: PolicyEventProps[];
}

export interface NewBusinessLine {
  kind: FinancialTransactionProps["kind"];
  code: string;
  label: string;
  coverage?: string;
  exposure?: string;
  remitter?: string;
  amount: Money;
}

export interface NewBusinessInput {
  tenantId: TenantId;
  number: string;
  productId: string;
  productName: string;
  productReleaseId: string;
  productVersion: string;
  jurisdiction: Jurisdiction;
  effectiveDate: PlainDate;
  expirationDate: PlainDate;
  insuredName: string;
  producer: { id: string; name: string };
  sourceSubmissionId: string;
  sourceQuoteId: string;
  writtenPremium: Money;
  taxesAndFees: Money;
  lines: NewBusinessLine[];
  snapshot: Record<string, unknown>;
  today: PlainDate;
  actor: TimelineActor;
  history: Omit<PolicyEventProps, "id" | "termId" | "transactionId" | "invoiceId">[];
}

export interface TransactionInvoice {
  id: string;
  number: string;
  kind: "invoice" | "credit_note";
  total: Money;
}

const formatMoney = (money: Money) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: money.currency }).format(
    Number(money.toString()),
  );

/** A policy across its terms, with its issued transactions and their money (PLAN §7.3–7.4, §13). */
export class Policy extends AggregateRoot {
  private readonly added = {
    transactions: [] as PolicyTransactionProps[],
    versions: [] as TermVersionProps[],
    financials: [] as FinancialTransactionProps[],
    documents: [] as PolicyDocumentProps[],
    events: [] as PolicyEventProps[],
  };

  private constructor(private state: PolicyState) {
    super();
  }

  static restore(state: PolicyState): Policy {
    return new Policy(state);
  }

  /** Bind: the policy, its first term and the issued NEW_BUSINESS transaction, in one go. */
  static issueNewBusiness(input: NewBusinessInput, clock: Clock): Policy {
    const now = clock.now();
    const termId = newId<"PolicyTerm">();
    const transactionId = newId();
    const started = Temporal.PlainDate.compare(input.today, input.effectiveDate) >= 0;

    const policy = new Policy({
      policy: {
        id: newId<"Policy">(),
        tenantId: input.tenantId,
        number: input.number,
        productId: input.productId,
        productName: input.productName,
        insuredName: input.insuredName,
        producer: input.producer,
        sourceSubmissionId: input.sourceSubmissionId,
        sourceQuoteId: input.sourceQuoteId,
        createdAt: now,
      },
      terms: [
        {
          id: termId,
          termNumber: 1,
          productReleaseId: input.productReleaseId,
          productVersion: input.productVersion,
          jurisdiction: input.jurisdiction,
          effectiveDate: input.effectiveDate,
          expirationDate: input.expirationDate,
          status: started ? "in_force" : "pending_effective",
          writtenPremium: input.writtenPremium,
          taxesAndFees: input.taxesAndFees,
          boundAt: now,
          activatedAt: started ? now : null,
          updatedAt: now,
        },
      ],
      transactions: [],
      versions: [],
      financials: [],
      documents: [],
      events: [],
    });

    for (const entry of input.history) {
      policy.addToTimeline({ ...entry, termId, transactionId: null, invoiceId: null });
    }

    const transaction: PolicyTransactionProps = {
      id: transactionId,
      termId,
      type: "NEW_BUSINESS",
      status: "issued",
      effectiveDate: input.effectiveDate,
      premiumDelta: input.writtenPremium,
      issuedAt: now,
    };

    policy.append("transactions", transaction);

    policy.append("versions", {
      id: newId(),
      termId,
      transactionId,
      version: 1,
      effectiveDate: input.effectiveDate,
      snapshot: input.snapshot,
      recordedAt: now,
    });

    for (const line of input.lines) {
      policy.append("financials", {
        id: newId(),
        termId,
        transactionId,
        ...line,
        effectiveDate: input.effectiveDate,
        recordedAt: now,
      });
    }

    const payload = {
      policyId: policy.id,
      termId,
      transactionId,
      number: input.number,
      effectiveDate: input.effectiveDate.toString(),
      status: policy.state.terms[0]!.status,
    };

    policy.recordEvent("policy.transaction_issued", now, { ...payload, type: "NEW_BUSINESS" });
    policy.recordEvent("policy.term_bound", now, payload);

    policy.addToTimeline({
      type: "bound",
      termId,
      transactionId,
      invoiceId: null,
      occurredAt: now,
      effectiveDate: input.effectiveDate,
      actor: input.actor,
      summary: `Bound as ${input.number}, effective ${input.effectiveDate.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" })}`,
      data: { status: payload.status },
    });

    return policy;
  }

  get id(): PolicyId {
    return this.state.policy.id;
  }

  get number(): string {
    return this.state.policy.number;
  }

  get firstTerm(): PolicyTermProps {
    return this.state.terms[0]!;
  }

  get firstTransaction(): PolicyTransactionProps {
    return this.state.transactions[0]!;
  }

  /** Links the transaction to its invoice: the transactional event and the invoice it raised. */
  billTransaction(
    transactionId: string,
    invoice: TransactionInvoice,
    actor: TimelineActor,
    clock: Clock,
  ): void {
    const transaction = this.state.transactions.find((t) => t.id === transactionId);

    if (!transaction) throw conflict(`Transaction ${transactionId} isn't on ${this.number}`);

    const now = clock.now();
    const link = { termId: transaction.termId, transactionId, invoiceId: invoice.id };
    const noun = invoice.kind === "credit_note" ? "Credit note" : "Invoice";

    this.addToTimeline({
      ...link,
      type: TRANSACTION_EVENT[transaction.type],
      occurredAt: now,
      effectiveDate: transaction.effectiveDate,
      actor,
      summary: `New business issued: ${formatMoney(transaction.premiumDelta)} written premium`,
      data: { premium: transaction.premiumDelta.toJSON(), invoiceNumber: invoice.number },
    });

    this.addToTimeline({
      ...link,
      type: "invoice_issued",
      occurredAt: now,
      effectiveDate: null,
      actor,
      summary: `${noun} ${invoice.number} issued for ${formatMoney(invoice.total)}`,
      data: { invoiceNumber: invoice.number, total: invoice.total.toJSON(), kind: invoice.kind },
    });
  }

  recordDocumentsGenerated(
    transactionId: string,
    titles: string[],
    actor: TimelineActor,
    clock: Clock,
  ): void {
    const transaction = this.state.transactions.find((t) => t.id === transactionId);

    this.addToTimeline({
      type: "documents_generated",
      termId: transaction?.termId ?? null,
      transactionId,
      invoiceId: null,
      occurredAt: clock.now(),
      effectiveDate: null,
      actor,
      summary: `Generated ${titles.join(" and ").toLowerCase()}`,
      data: { documents: titles },
    });
  }

  /** Appends an event another context recorded about this policy (payments, notes). */
  addToTimeline(entry: Omit<PolicyEventProps, "id" | "category">): void {
    const event: PolicyEventProps = { ...entry, id: newId(), category: categoryOf(entry.type) };
    assertLinked(event);
    this.append("events", event);
  }

  attachDocument(document: Omit<PolicyDocumentProps, "id" | "createdAt">, clock: Clock): void {
    if (!this.state.transactions.some((t) => t.id === document.transactionId)) {
      throw conflict(`Transaction ${document.transactionId} isn't on ${this.number}`);
    }

    if (this.state.documents.some((d) => d.storageKey === document.storageKey)) return;

    this.append("documents", { ...document, id: newId(), createdAt: clock.now() });
  }

  /** The effective-date timer (PLAN §7.3). A no-op before the date or once it already ran. */
  activateTerm(termId: PolicyTermId, today: PlainDate, clock: Clock): boolean {
    const term = this.state.terms.find((t) => t.id === termId);

    if (!term) throw conflict(`Term ${termId} isn't on ${this.number}`);

    if (term.status !== "pending_effective") return false;

    if (Temporal.PlainDate.compare(today, term.effectiveDate) < 0) return false;

    this.transitionTerm(term, "in_force", clock);
    term.activatedAt = clock.now();
    this.recordEvent("policy.term_activated", clock.now(), { termId, number: this.number });

    this.addToTimeline({
      type: "became_effective",
      termId,
      transactionId: null,
      invoiceId: null,
      occurredAt: clock.now(),
      effectiveDate: term.effectiveDate,
      actor: { type: "system", name: "Effective-date timer" },
      summary: "Coverage is in force",
      data: {},
    });

    return true;
  }

  toSnapshot(): Readonly<PolicyState> {
    return this.state;
  }

  pullAdded() {
    const added = {
      transactions: [...this.added.transactions],
      versions: [...this.added.versions],
      financials: [...this.added.financials],
      documents: [...this.added.documents],
      events: [...this.added.events],
    };

    for (const list of Object.values(this.added)) list.length = 0;

    return added;
  }

  private transitionTerm(term: PolicyTermProps, to: TermStatus, clock: Clock): void {
    if (!TERM_TRANSITIONS[term.status].includes(to)) {
      throw conflict(
        `A ${term.status.replace("_", " ")} term can't become ${to.replace("_", " ")}`,
      );
    }

    term.status = to;
    term.updatedAt = clock.now();
  }

  private append<K extends keyof Policy["added"]>(
    key: K,
    item: Policy["added"][K][number] & PolicyState[K][number],
  ): void {
    (this.state[key] as unknown[]).push(item);
    (this.added[key] as unknown[]).push(item);
  }

  private recordEvent(type: string, occurredAt: Instant, payload: Record<string, unknown>): void {
    const event: DomainEvent = {
      id: newId(),
      type,
      tenantId: this.state.policy.tenantId,
      aggregateType: "policy",
      aggregateId: this.state.policy.id,
      occurredAt,
      payload,
    };

    this.record(event);
  }
}
