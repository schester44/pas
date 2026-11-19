import {
  AggregateRoot,
  type Clock,
  conflict,
  DomainError,
  type DomainEvent,
  type Id,
  type Instant,
  type Jurisdiction,
  invalid,
  Money,
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
  timelinePayload,
} from "./policy-event";
import {
  assertTransition,
  chargesOf,
  OPEN_STATUSES,
  type PolicyTransactionProps,
  premiumOf,
  type TransactionDetails,
  type TransactionType,
} from "./transaction";
import { annualOf } from "./term-state";

export type PolicyId = Id<"Policy">;

const TRANSACTION_EVENT: Record<TransactionType, PolicyEventType> = {
  NEW_BUSINESS: "new_business",
  ENDORSEMENT: "endorsement",
  CANCELLATION: "cancellation",
  CANCELLATION_RESCISSION: "cancellation_rescission",
  REINSTATEMENT: "reinstatement",
};

export type PolicyTermId = Id<"PolicyTerm">;
export type TermStatus =
  | "pending_effective"
  | "in_force"
  | "pending_cancellation"
  | "expired"
  | "cancelled";

const TERM_TRANSITIONS: Record<TermStatus, readonly TermStatus[]> = {
  pending_effective: ["in_force", "pending_cancellation", "cancelled"],
  in_force: ["expired", "pending_cancellation", "cancelled"],
  pending_cancellation: ["in_force", "pending_effective", "cancelled"],
  expired: [],
  cancelled: ["in_force", "pending_effective"],
};

export interface TermCancellation {
  transactionId: string;
  effectiveDate: PlainDate;
  reason: string;
  reasonLabel: string;
  status: "pending" | "effective";
}

export type { PolicyTransactionProps } from "./transaction";

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
  cancellation: TermCancellation | null;
  billingMethod: BillingMethod;
  payPlan: string | null;
  updatedAt: Instant;
}

export type BillingMethod = "direct" | "agency" | "mortgagee";

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

/** Who wrote the policy and through which agency (PLAN §4 Distribution); moved by a BOR change. */
export interface ProducerOfRecord {
  id: string;
  name: string;
  agencyId: string | null;
  agencyName: string | null;
}

export interface PolicyProps {
  id: PolicyId;
  tenantId: TenantId;
  number: string;
  productId: string;
  productName: string;
  insuredName: string;
  producer: ProducerOfRecord;
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
  producer: ProducerOfRecord;
  sourceSubmissionId: string;
  sourceQuoteId: string;
  writtenPremium: Money;
  taxesAndFees: Money;
  lines: NewBusinessLine[];
  snapshot: Record<string, unknown>;
  billingMethod: BillingMethod;
  payPlan: string | null;
  today: PlainDate;
  actor: TimelineActor;
  history: Omit<PolicyEventProps, "id" | "termId" | "transactionId" | "invoiceId">[];
}

export interface TransactionInvoice {
  id: string;
  number: string;
  kind: "invoice" | "credit_note";
  total: Money;
  spread?: { installments: number; numbers: string[] };
  netted?: { credited: Money; installments: number };
}

const compare = Temporal.PlainDate.compare;

const listOf = (items: string[]) => new Intl.ListFormat("en-US").format(items);

const formatDate = (date: PlainDate) =>
  date.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" });

const LABELS: Record<TransactionType, string> = {
  NEW_BUSINESS: "new business",
  ENDORSEMENT: "endorsement",
  CANCELLATION: "cancellation",
  CANCELLATION_RESCISSION: "cancellation rescission",
  REINSTATEMENT: "reinstatement",
};

const label = (type: TransactionType) => LABELS[type];
const article = (noun: string) => `${/^[aeiou]/.test(noun) ? "an" : "a"} ${noun}`;
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const annualTotal = (snapshot: Record<string, unknown>, currency: string) =>
  annualOf(snapshot, currency);

const isPrimitive = (value: unknown) =>
  value === null || ["string", "number"].includes(typeof value);

const capitalizeFirst = (text: string, after: boolean) => (after ? text : capitalize(text));

function transactionSummary(t: PolicyTransactionProps): string {
  const premium = t.premiumDelta;
  const amount = formatMoney(premium.isNegative() ? premium.negated() : premium);

  const money = premium.isZero()
    ? "no premium change"
    : premium.isNegative()
      ? `${amount} return premium`
      : `${amount} additional premium`;

  switch (t.type) {
    case "NEW_BUSINESS":
      return `New business issued: ${formatMoney(premium)} written premium`;
    case "ENDORSEMENT": {
      const changes = (t.details?.changes ?? []).map((c) =>
        isPrimitive(c.before) && isPrimitive(c.after) && c.before !== null && c.after !== null
          ? `${c.label} ${c.before} → ${c.after}`
          : c.label,
      );

      const listed =
        changes.length > 2 ? [...changes.slice(0, 2), `${changes.length - 2} more`] : changes;

      return [...listed, capitalizeFirst(money, listed.length > 0)].join(" · ");
    }
    case "CANCELLATION": {
      const c = t.details?.cancellation;

      const why =
        c?.initiator === "insured"
          ? "at the insured's request"
          : `for ${c?.reasonLabel.toLowerCase() ?? "a stated reason"}`;

      const kept = c?.minimumEarned
        ? ` · minimum earned premium ${formatMoney(c.minimumEarned.retained)} retained`
        : "";

      return `Cancelled ${why}, effective ${formatDate(t.effectiveDate)}: ${money}${kept}`;
    }
    case "CANCELLATION_RESCISSION":
      return `Pending cancellation rescinded; coverage continues${t.details?.note ? `. ${t.details.note}` : ""}`;
    case "REINSTATEMENT":
      return `Reinstated ${t.details?.reinstatement?.lapse ? "with a lapse in coverage" : "without a lapse"}: ${money}`;
  }
}

const formatMoney = (money: Money) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: money.currency }).format(
    Number(money.toString()),
  );

/** A policy across its terms, with its issued transactions and their money (PLAN §7.3–7.4, §13). */
export class Policy extends AggregateRoot {
  private readonly touched = new Set<string>();
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
          cancellation: null,
          billingMethod: input.billingMethod,
          payPlan: input.payPlan,
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
      baseVersion: 0,
      details: null,
      createdBy: input.actor,
      createdAt: now,
      updatedAt: now,
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

  /**
   * The transactional event, linked to the invoice or credit note that bills it (PLAN §7.4.1).
   * Premium-neutral transactions have no bill.
   */
  billTransaction(
    transactionId: string,
    invoice: TransactionInvoice | null,
    actor: TimelineActor,
    clock: Clock,
  ): void {
    const transaction = this.transaction(transactionId);
    const now = clock.now();
    const link = { termId: transaction.termId, transactionId, invoiceId: invoice?.id ?? null };
    const details = transaction.details;

    this.addToTimeline({
      ...link,
      type: TRANSACTION_EVENT[transaction.type],
      occurredAt: now,
      effectiveDate: transaction.effectiveDate,
      actor,
      summary: transactionSummary(transaction),
      data: {
        premium: transaction.premiumDelta.toJSON(),
        ...(invoice ? { invoiceNumber: invoice.number } : { premiumNeutral: true }),
        ...(details?.changes.length && {
          changes: details.changes.map((c) => ({
            label: c.label,
            before: c.before,
            after: c.after,
          })),
        }),
        ...(details?.cancellation && {
          reason: details.cancellation.reason,
          method: details.cancellation.method,
          minimumEarned: details.cancellation.minimumEarned && {
            type: details.cancellation.minimumEarned.rule.type,
            value: details.cancellation.minimumEarned.rule.value,
            level: details.cancellation.minimumEarned.rule.level,
            minimum: details.cancellation.minimumEarned.minimum.toJSON(),
            retained: details.cancellation.minimumEarned.retained.toJSON(),
          },
          fullyEarnedFees: details.cancellation.fullyEarnedFees,
        }),
        ...(details?.reinstatement && { lapse: details.reinstatement.lapse }),
        ...(details?.note && { note: details.note }),
      },
    });

    if (!invoice) return;

    if (invoice.kind === "credit_note") {
      this.recordEvent("policy.credit_note_issued", now, {
        policyId: this.id,
        transactionId,
        invoiceId: invoice.id,
        number: this.number,
      });
    }

    const noun = invoice.kind === "credit_note" ? "Credit note" : "Invoice";

    const summary = invoice.spread
      ? `${formatMoney(invoice.total)} spread over the ${invoice.spread.installments === 1 ? "remaining installment" : `${invoice.spread.installments} remaining installments`} (${invoice.spread.numbers.join(", ")})`
      : `${noun} ${invoice.number} issued for ${formatMoney(invoice.total)}${
          invoice.netted && !invoice.netted.credited.isZero()
            ? `; ${formatMoney(invoice.netted.credited)} netted against unpaid installments`
            : ""
        }`;

    this.addToTimeline({
      ...link,
      type: "invoice_issued",
      occurredAt: now,
      effectiveDate: null,
      actor,
      summary,
      data: {
        invoiceNumber: invoice.number,
        total: invoice.total.toJSON(),
        kind: invoice.kind,
        ...(invoice.spread && { spread: invoice.spread }),
        ...(invoice.netted && {
          netted: {
            credited: invoice.netted.credited.toJSON(),
            installments: invoice.netted.installments,
          },
        }),
      },
    });
  }

  term(termId: string): PolicyTermProps {
    const term = this.state.terms.find((t) => t.id === termId);

    if (!term) throw conflict(`Term ${termId} isn't on ${this.number}`);

    return term;
  }

  get currentTerm(): PolicyTermProps {
    return this.state.terms.at(-1)!;
  }

  transaction(id: string): PolicyTransactionProps {
    const transaction = this.state.transactions.find((t) => t.id === id);

    if (!transaction) throw conflict(`Transaction ${id} isn't on ${this.number}`);

    return transaction;
  }

  latestVersion(termId: string): TermVersionProps {
    return this.state.versions
      .filter((v) => v.termId === termId)
      .reduce((latest, v) => (v.version > latest.version ? v : latest));
  }

  /** The issued transaction with the latest effective date: changes can't go before it yet. */
  lastIssued(termId: string): PolicyTransactionProps | null {
    return this.state.transactions
      .filter((t) => t.termId === termId && t.status === "issued")
      .reduce<PolicyTransactionProps | null>(
        (last, t) => (!last || compare(t.effectiveDate, last.effectiveDate) >= 0 ? t : last),
        null,
      );
  }

  openTransaction(termId: string): PolicyTransactionProps | null {
    return (
      this.state.transactions.find(
        (t) => t.termId === termId && OPEN_STATUSES.includes(t.status),
      ) ?? null
    );
  }

  /** Guards every mid-term change: the term's state, the date, and sequence (PLAN §7.4). */
  assertChangeable(
    termId: string,
    type: TransactionType,
    effectiveDate: PlainDate,
    except?: string,
  ) {
    const term = this.term(termId);

    const allowed: Record<TransactionType, readonly TermStatus[]> = {
      NEW_BUSINESS: [],
      ENDORSEMENT: ["pending_effective", "in_force"],
      CANCELLATION: ["pending_effective", "in_force"],
      CANCELLATION_RESCISSION: ["pending_cancellation"],
      REINSTATEMENT: ["cancelled"],
    };

    if (!allowed[type].includes(term.status)) {
      const hint =
        term.status === "pending_cancellation" ? " Rescind the pending cancellation first." : "";

      throw new DomainError(
        "precondition_failed",
        `A ${term.status.replace("_", " ")} policy can't take a ${label(type)}.${hint}`,
        { reason: "term_status", status: term.status },
      );
    }

    if (
      compare(effectiveDate, term.effectiveDate) < 0 ||
      compare(effectiveDate, term.expirationDate) >= 0
    ) {
      throw invalid("Pick an effective date within the term", {
        field: "effectiveDate",
        termStart: term.effectiveDate.toString(),
        termEnd: term.expirationDate.toString(),
      });
    }

    const latest = this.lastIssued(termId);

    if (latest && compare(effectiveDate, latest.effectiveDate) < 0) {
      throw new DomainError(
        "precondition_failed",
        `Out-of-sequence changes aren't supported yet: this policy already has ${article(label(latest.type))} effective ${formatDate(latest.effectiveDate)}. Pick that date or later.`,
        { reason: "out_of_sequence", latest: latest.effectiveDate.toString() },
      );
    }

    const open = this.openTransaction(termId);

    if (open && open.id !== except) {
      throw new DomainError(
        "precondition_failed",
        `Finish or discard the open ${label(open.type)} first`,
        { reason: "open_transaction", transactionId: open.id },
      );
    }
  }

  /** Creates or re-rates a quoted transaction (`draft → quoted`). */
  quoteTransaction(
    input: {
      termId: string;
      type: TransactionType;
      transactionId?: string;
      effectiveDate: PlainDate;
      details: TransactionDetails;
      actor: TimelineActor;
    },
    clock: Clock,
  ): PolicyTransactionProps {
    this.assertChangeable(input.termId, input.type, input.effectiveDate, input.transactionId);

    const now = clock.now();
    const currency = this.term(input.termId).writtenPremium.currency;
    const baseVersion = this.latestVersion(input.termId).version;

    if (input.transactionId) {
      const existing = this.transaction(input.transactionId);

      if (existing.type !== input.type) throw conflict("That transaction is a different type");

      assertTransition(existing.status, "quoted");

      Object.assign(existing, {
        status: "quoted",
        effectiveDate: input.effectiveDate,
        details: input.details,
        premiumDelta: premiumOf(input.details, currency),
        baseVersion,
        updatedAt: now,
      });

      this.touched.add(existing.id);

      return existing;
    }

    const transaction: PolicyTransactionProps = {
      id: newId(),
      termId: input.termId,
      type: input.type,
      status: "quoted",
      effectiveDate: input.effectiveDate,
      premiumDelta: premiumOf(input.details, currency),
      baseVersion,
      details: input.details,
      createdBy: input.actor,
      createdAt: now,
      updatedAt: now,
      issuedAt: null,
    };

    this.append("transactions", transaction);

    return transaction;
  }

  /** Referred by rules, or the actor lacks the authority to issue (PLAN §7.4). */
  requestApproval(id: string, reasons: string[], actor: TimelineActor, clock: Clock): void {
    const transaction = this.transaction(id);

    if (transaction.status === "pending_approval") return;

    this.move(transaction, "pending_approval", clock);

    this.addToTimeline({
      type: "referred",
      termId: transaction.termId,
      transactionId: null,
      invoiceId: null,
      occurredAt: clock.now(),
      effectiveDate: transaction.effectiveDate,
      actor,
      summary: `${capitalize(label(transaction.type))} sent for approval${reasons.length ? `: ${reasons.join("; ")}` : ""}`,
      data: { transactionId: id, type: transaction.type, reasons },
    });

    this.recordEvent("policy.transaction_referred", clock.now(), {
      transactionId: id,
      type: transaction.type,
      number: this.number,
    });
  }

  discardTransaction(id: string, actor: TimelineActor, clock: Clock, note?: string): void {
    const transaction = this.transaction(id);

    if (transaction.status === "discarded") return;

    if (transaction.status === "scheduled") {
      throw conflict("Rescind a scheduled cancellation instead of discarding it");
    }

    this.move(transaction, "discarded", clock);

    if (note) transaction.details = { ...transaction.details!, note };
  }

  /** Notice issued: the term waits for the cancellation date (PLAN §7.3). */
  scheduleCancellation(id: string, actor: TimelineActor, clock: Clock): void {
    const transaction = this.transaction(id);
    const cancellation = transaction.details?.cancellation;

    if (transaction.type !== "CANCELLATION" || !cancellation) throw conflict("Not a cancellation");

    this.assertBase(transaction);
    this.move(transaction, "scheduled", clock);

    const term = this.term(transaction.termId);

    this.transitionTerm(term, "pending_cancellation", clock);

    term.cancellation = {
      transactionId: id,
      effectiveDate: transaction.effectiveDate,
      reason: cancellation.reason,
      reasonLabel: cancellation.reasonLabel,
      status: "pending",
    };

    this.addToTimeline({
      type: "pending_cancellation",
      termId: term.id,
      transactionId: null,
      invoiceId: null,
      occurredAt: clock.now(),
      effectiveDate: transaction.effectiveDate,
      actor,
      summary: `Cancellation scheduled for ${formatDate(transaction.effectiveDate)}: ${cancellation.reasonLabel.toLowerCase()}`,
      data: {
        transactionId: id,
        reason: cancellation.reason,
        noticeDate: cancellation.noticeDate,
        earliestDate: cancellation.earliestDate,
        minDaysNotice: cancellation.minDaysNotice,
        mailingDaysAdded: cancellation.mailingDaysAdded,
      },
    });

    this.recordEvent("policy.cancellation_scheduled", clock.now(), {
      termId: term.id,
      transactionId: id,
      effectiveDate: transaction.effectiveDate.toString(),
      number: this.number,
    });
  }

  recordNoticeSent(
    input: {
      transactionId: string;
      title: string;
      delivery: string;
      recipients: string[];
      emailed: string[];
      mailed: string[];
    },
    actor: TimelineActor,
    clock: Clock,
  ): void {
    const transaction = this.transaction(input.transactionId);

    const channels = [
      input.emailed.length > 0 && `emailed to ${listOf(input.emailed)}`,
      input.mailed.length > 0 && `mailed to ${listOf(input.mailed)}`,
    ].filter(Boolean);

    this.addToTimeline({
      type: "notice_sent",
      termId: transaction.termId,
      transactionId: null,
      invoiceId: null,
      occurredAt: clock.now(),
      effectiveDate: transaction.effectiveDate,
      actor,
      summary: channels.length
        ? `${input.title} ${channels.join(" and ")}`
        : `${input.title} generated; no email or mailing address on file`,
      data: {
        transactionId: input.transactionId,
        requiredDelivery: input.delivery,
        sentBy: input.mailed.length > 0 ? "mail" : "electronic",
        emailed: input.emailed,
        mailed: input.mailed,
        proofOfMailing: null,
        recipients: input.recipients,
      },
    });
  }

  /** Proof of mailing for a mailed notice, if the mail provider has recorded it. */
  hasProofOfMailing(transactionId: string): boolean {
    return this.state.events.some(
      (e) =>
        e.type === "notice_mailed" &&
        e.data.transactionId === transactionId &&
        e.data.proofOfMailing,
    );
  }

  /**
   * No proof, no cancellation (PLAN §17.3): the term stays pending and compliance is told once.
   * Returns false when the hold was already recorded.
   */
  holdCancellation(transactionId: string, clock: Clock): boolean {
    const transaction = this.transaction(transactionId);

    if (
      this.state.events.some(
        (e) => e.type === "cancellation_held" && e.data.transactionId === transactionId,
      )
    ) {
      return false;
    }

    const now = clock.now();

    this.addToTimeline({
      type: "cancellation_held",
      termId: transaction.termId,
      transactionId: null,
      invoiceId: null,
      occurredAt: now,
      effectiveDate: transaction.effectiveDate,
      actor: { type: "system", name: "Cancellation timer" },
      summary: "Cancellation held: the notice has no proof of mailing yet",
      data: { transactionId, reason: "no_proof_of_mailing" },
    });

    this.recordEvent("policy.cancellation_held", now, {
      policyId: this.id,
      termId: transaction.termId,
      transactionId,
      number: this.number,
      reason: "no_proof_of_mailing",
    });

    return true;
  }

  /**
   * Issues the transaction: appends its TermVersion and financial transactions and moves the
   * term (PLAN §7.1, §7.4). Returns the lines to bill; empty when premium-neutral.
   */
  issueTransaction(id: string, today: PlainDate, clock: Clock, approvedBy?: TimelineActor) {
    const transaction = this.transaction(id);
    const details = transaction.details;

    if (!details) throw conflict("This transaction has nothing to issue");

    if (transaction.status === "issued") return chargesOf(details);

    this.assertBase(transaction);

    if (transaction.type === "CANCELLATION" && compare(today, transaction.effectiveDate) < 0) {
      throw conflict(`This cancellation takes effect on ${formatDate(transaction.effectiveDate)}`);
    }

    const now = clock.now();
    const term = this.term(transaction.termId);
    const latest = this.latestVersion(term.id);

    this.move(transaction, "issued", clock);
    transaction.issuedAt = now;

    if (approvedBy) transaction.details = { ...details, approvedBy };

    this.append("versions", {
      id: newId(),
      termId: term.id,
      transactionId: id,
      version: latest.version + 1,
      effectiveDate: transaction.effectiveDate,
      snapshot: details.after ?? latest.snapshot,
      recordedAt: now,
    });

    const charges = chargesOf(details);

    for (const line of charges) {
      this.append("financials", {
        id: newId(),
        termId: term.id,
        transactionId: id,
        ...line,
        effectiveDate: transaction.effectiveDate,
        recordedAt: now,
      });
    }

    this.refreshPremium(term);

    if (transaction.type === "CANCELLATION") {
      this.transitionTerm(term, "cancelled", clock);

      term.cancellation = {
        transactionId: id,
        effectiveDate: transaction.effectiveDate,
        reason: details.cancellation!.reason,
        reasonLabel: details.cancellation!.reasonLabel,
        status: "effective",
      };
    }

    if (transaction.type === "CANCELLATION_RESCISSION" || transaction.type === "REINSTATEMENT") {
      this.restoreTerm(term, today, clock);
    }

    this.recordEvent("policy.transaction_issued", now, {
      policyId: this.id,
      termId: term.id,
      transactionId: id,
      type: transaction.type,
      number: this.number,
      effectiveDate: transaction.effectiveDate.toString(),
      status: term.status,
    });

    return charges;
  }

  /** Withdraws the pending cancellation as if it never happened (cure, PLAN §7.4, §17.3). */
  rescindCancellation(
    termId: string,
    input: { actor: TimelineActor; note?: string; today: PlainDate },
    clock: Clock,
  ): PolicyTransactionProps {
    const term = this.term(termId);

    if (term.status !== "pending_cancellation" || !term.cancellation) {
      throw new DomainError("precondition_failed", "There's no pending cancellation to rescind");
    }

    const pending = this.transaction(term.cancellation.transactionId);

    this.move(pending, "discarded", clock);

    const currency = term.writtenPremium.currency;
    const annual = this.latestVersion(termId).snapshot;

    const rescission = this.quoteTransaction(
      {
        termId,
        type: "CANCELLATION_RESCISSION",
        effectiveDate: pending.effectiveDate,
        details: {
          after: null,
          premium: [],
          retained: [],
          fees: [],
          annualBefore: annualTotal(annual, currency),
          annualAfter: annualTotal(annual, currency),
          changes: [],
          referrals: [],
          cancellation: pending.details!.cancellation!,
          ...(input.note && { note: input.note }),
        },
        actor: input.actor,
      },
      clock,
    );

    this.issueTransaction(rescission.id, input.today, clock);

    return rescission;
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

    this.recordEvent(
      "policy.timeline_recorded",
      event.occurredAt,
      timelinePayload(this.id, this.number, event),
    );
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

    const pending = term.status === "pending_cancellation" && !term.activatedAt;

    if (term.status !== "pending_effective" && !pending) return false;

    if (Temporal.PlainDate.compare(today, term.effectiveDate) < 0) return false;

    if (!pending) this.transitionTerm(term, "in_force", clock);

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

  /** Broker of record change: the policy moves to another producer and agency from a date. */
  /** Billing moved the term to another payer (a lender's bill taken over by the insured). */
  changeBillingMethod(termId: string, method: BillingMethod, clock: Clock): boolean {
    const term = this.term(termId);

    if (term.billingMethod === method) return false;

    term.billingMethod = method;
    term.updatedAt = clock.now();

    return true;
  }

  changeProducer(
    input: {
      producer: ProducerOfRecord;
      effectiveDate: PlainDate;
      reason: string;
      actor: TimelineActor;
    },
    clock: Clock,
  ): void {
    const before = this.state.policy.producer;
    const after = input.producer;

    if (before.id === after.id && before.agencyId === after.agencyId) {
      throw conflict(`${after.name} is already the producer of record`);
    }

    const now = clock.now();

    const describe = (p: ProducerOfRecord) =>
      p.agencyName ? `${p.name} (${p.agencyName})` : p.name;

    this.state.policy.producer = after;

    this.addToTimeline({
      type: "producer_changed",
      termId: this.currentTerm.id,
      transactionId: null,
      invoiceId: null,
      occurredAt: now,
      effectiveDate: input.effectiveDate,
      actor: input.actor,
      summary: `Producer of record changed from ${describe(before)} to ${describe(after)}, effective ${formatDate(input.effectiveDate)}`,
      data: { before, after, reason: input.reason },
    });

    this.recordEvent("policy.producer_changed", now, {
      number: this.number,
      before,
      after,
      effectiveDate: input.effectiveDate.toString(),
    });
  }

  /** A client asked for a change; the producer of record picks it up from the event. */
  recordChangeRequest(
    request: { id: string; kind: string; summary: string; details: string; actor: TimelineActor },
    clock: Clock,
  ): void {
    const now = clock.now();

    this.addToTimeline({
      type: "change_requested",
      termId: this.firstTerm.id,
      transactionId: null,
      invoiceId: null,
      occurredAt: now,
      effectiveDate: null,
      actor: request.actor,
      summary: request.summary,
      data: { changeRequestId: request.id, kind: request.kind, details: request.details },
    });

    this.recordEvent("policy.change_requested", now, {
      changeRequestId: request.id,
      kind: request.kind,
      number: this.number,
      producerId: this.state.policy.producer.id,
    });
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

    const touched = this.state.transactions.filter(
      (t) => this.touched.has(t.id) && !added.transactions.some((a) => a.id === t.id),
    );

    for (const list of Object.values(this.added)) list.length = 0;

    this.touched.clear();

    return { ...added, touched };
  }

  private move(
    transaction: PolicyTransactionProps,
    to: PolicyTransactionProps["status"],
    clock: Clock,
  ) {
    assertTransition(transaction.status, to);
    transaction.status = to;
    transaction.updatedAt = clock.now();
    this.touched.add(transaction.id);
  }

  private assertBase(transaction: PolicyTransactionProps) {
    if (transaction.baseVersion !== this.latestVersion(transaction.termId).version) {
      throw new DomainError(
        "precondition_failed",
        "The policy changed since this was priced. Preview the change again.",
        { reason: "stale_quote" },
      );
    }
  }

  private refreshPremium(term: PolicyTermProps) {
    const lines = this.state.financials.filter((f) => f.termId === term.id);
    const currency = term.writtenPremium.currency;

    const sum = (kind: FinancialTransactionProps["kind"]) =>
      lines
        .filter((f) => f.kind === kind)
        .reduce((total, f) => total.plus(f.amount), Money.zero(currency));

    term.writtenPremium = sum("written_premium");
    term.taxesAndFees = sum("tax_fee");
  }

  /** Status is derived from the clock once nothing stands in the way (PLAN §7.3). */
  private restoreTerm(term: PolicyTermProps, today: PlainDate, clock: Clock) {
    const started = compare(today, term.effectiveDate) >= 0;

    this.transitionTerm(term, started ? "in_force" : "pending_effective", clock);
    term.cancellation = null;

    if (started && !term.activatedAt) term.activatedAt = clock.now();
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
