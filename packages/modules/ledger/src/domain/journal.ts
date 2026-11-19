import {
  type Clock,
  type Instant,
  invalid,
  Money,
  newId,
  type PlainDate,
  type TenantId,
} from "@pas/kernel";
import type { PayerType } from "./accounts";

/** The ledger stores money at the currency's minor unit; anything finer must be rounded first. */
export const MINOR_UNITS = 2;

export interface LineDimensions {
  payerType?: PayerType | null;
  payerRef?: string | null;
  policyId?: string | null;
  invoiceId?: string | null;
  paymentId?: string | null;
  agencyId?: string | null;
  jurisdiction?: string | null;
}

/** Positive amounts are debits, negative amounts credits. */
export interface JournalLine extends LineDimensions {
  account: string;
  amount: Money;
}

export interface EntryActor {
  type: "user" | "system" | "api";
  id?: string | null;
  name: string;
}

export interface JournalEntryProps {
  id: string;
  tenantId: TenantId;
  number: number;
  key: string;
  kind: string;
  source: { type: string; id: string };
  effectiveOn: PlainDate;
  recordedAt: Instant;
  actor: EntryActor;
  memo: string;
  reversesId: string | null;
  billingEventId: string | null;
  lines: readonly JournalLine[];
}

export type EntryDraft = Omit<
  JournalEntryProps,
  "id" | "tenantId" | "number" | "recordedAt" | "reversesId" | "billingEventId"
> &
  Partial<Pick<JournalEntryProps, "billingEventId">>;

export const debit = (account: string, amount: Money, dims: LineDimensions = {}): JournalLine => ({
  ...dims,
  account,
  amount,
});

export const credit = (account: string, amount: Money, dims: LineDimensions = {}): JournalLine => ({
  ...dims,
  account,
  amount: amount.negated(),
});

/** Sum of signed amounts per currency. */
export function totalsByCurrency(lines: readonly JournalLine[]): Map<string, Money> {
  const totals = new Map<string, Money>();

  for (const line of lines) {
    const current = totals.get(line.amount.currency) ?? Money.zero(line.amount.currency);
    totals.set(line.amount.currency, current.plus(line.amount));
  }

  return totals;
}

export function assertBalanced(lines: readonly JournalLine[]): void {
  if (lines.length < 2) throw invalid("A journal entry needs at least two lines");

  for (const line of lines) {
    if (line.amount.isZero()) throw invalid(`A line on ${line.account} is zero`);

    if (line.amount.amount.decimalPlaces() > MINOR_UNITS) {
      throw invalid(`${line.amount.toString()} on ${line.account} isn't rounded to the cent`);
    }
  }

  for (const [currency, total] of totalsByCurrency(lines)) {
    if (!total.isZero()) {
      throw invalid(`Debits and credits differ by ${total.toString()} ${currency}`, {
        currency,
        difference: total.toString(),
      });
    }
  }
}

const dropZero = (lines: readonly JournalLine[]) => lines.filter((l) => !l.amount.isZero());

/**
 * An immutable, balanced journal entry. Once posted it never changes: a correction is a reversing
 * entry that negates every line and points back at the original.
 */
export class JournalEntry {
  private constructor(private readonly props: JournalEntryProps) {}

  static draft(input: EntryDraft & { tenantId: TenantId }, clock: Clock): JournalEntry {
    const lines = dropZero(input.lines);

    assertBalanced(lines);

    return new JournalEntry({
      ...input,
      lines,
      id: newId(),
      number: 0,
      recordedAt: clock.now(),
      reversesId: null,
      billingEventId: input.billingEventId ?? null,
    });
  }

  static restore(props: JournalEntryProps): JournalEntry {
    return new JournalEntry(props);
  }

  get id(): string {
    return this.props.id;
  }

  get key(): string {
    return this.props.key;
  }

  get lines(): readonly JournalLine[] {
    return this.props.lines;
  }

  reverse(
    input: {
      key: string;
      kind?: string;
      effectiveOn: PlainDate;
      actor: EntryActor;
      memo: string;
      billingEventId?: string;
    },
    clock: Clock,
  ): JournalEntry {
    if (this.props.reversesId) throw invalid("A reversing entry can't itself be reversed");

    return new JournalEntry({
      ...this.props,
      id: newId(),
      number: 0,
      key: input.key,
      kind: input.kind ?? `${this.props.kind}.reversed`,
      effectiveOn: input.effectiveOn,
      recordedAt: clock.now(),
      actor: input.actor,
      memo: input.memo,
      reversesId: this.props.id,
      billingEventId: input.billingEventId ?? null,
      lines: this.props.lines.map((line) => ({ ...line, amount: line.amount.negated() })),
    });
  }

  toSnapshot(): Readonly<JournalEntryProps> {
    return this.props;
  }
}
