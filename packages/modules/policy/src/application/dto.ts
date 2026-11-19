import type { Money } from "@pas/kernel";
import type { Policy, PolicyTransactionProps, TermStatus } from "../domain/policy";
import { annualOf, coveragesOf } from "../domain/term-state";
import { chargesOf } from "../domain/transaction";

type MoneyDto = { amount: string; currency: string };

const money = (value: Money): MoneyDto => value.toJSON();

export interface PolicySummaryDto {
  id: string;
  number: string;
  insuredName: string;
  productId: string;
  productName: string;
  producerId: string;
  producerName: string;
  producerAgency: string | null;
  agencyId: string | null;
  jurisdiction: { country: string; subdivision?: string };
  effectiveDate: string;
  expirationDate: string;
  status: TermStatus;
  cancellation: {
    transactionId: string;
    effectiveDate: string;
    reason: string;
    reasonLabel: string;
    status: "pending" | "effective";
  } | null;
  annualPremium: MoneyDto;
  writtenPremium: MoneyDto;
  taxesAndFees: MoneyDto;
  total: MoneyDto;
  boundAt: string;
}

export interface PolicyDetailDto extends PolicySummaryDto {
  sourceSubmissionId: string;
  productVersion: string;
  coverages: {
    coverage: string;
    name: string;
    exposure?: string;
    limit?: unknown;
    deductible?: unknown;
    premium: MoneyDto;
  }[];
  transactions: TransactionDto[];
  openTransaction: TransactionDto | null;
  financials: {
    id: string;
    kind: string;
    code: string;
    label: string;
    coverage?: string;
    exposure?: string;
    remitter?: string;
    amount: MoneyDto;
    effectiveDate: string;
    recordedAt: string;
  }[];
  documents: { id: string; kind: string; title: string; sizeBytes: number; createdAt: string }[];
  activatedAt: string | null;
  events: {
    id: string;
    type: string;
    category: string;
    occurredAt: string;
    effectiveDate: string | null;
    actor: { type: string; id?: string; name: string };
    summary: string;
    data: Record<string, unknown>;
    transactionId: string | null;
    invoiceId: string | null;
  }[];
}

export interface TransactionDto {
  id: string;
  type: PolicyTransactionProps["type"];
  status: PolicyTransactionProps["status"];
  effectiveDate: string;
  premiumDelta: MoneyDto;
  total: MoneyDto;
  createdAt: string;
  createdBy: string | null;
  issuedAt: string | null;
  annualBefore: MoneyDto | null;
  annualAfter: MoneyDto | null;
  premium: {
    coverage: string;
    exposure?: string;
    name: string;
    before: MoneyDto;
    after: MoneyDto;
    amount: MoneyDto;
  }[];
  retained: { name: string; minimum: MoneyDto; amount: MoneyDto }[];
  fees: { code: string; label: string; amount: MoneyDto }[];
  changes: { path: string; label: string; before: unknown; after: unknown }[];
  coverages: PolicyDetailDto["coverages"] | null;
  referrals: { reasonCode: string; message: string; outcome: string; authority?: string }[];
  cancellation: {
    reason: string;
    reasonLabel: string;
    initiator: string;
    method: string;
    noticeDate: string;
    earliestDate: string;
    minDaysNotice: number;
    mailingDaysAdded: number;
    delivery: string;
    minimumEarned: {
      type: string;
      value: string;
      level: string;
      minimum: MoneyDto;
      retained: MoneyDto;
    } | null;
    fullyEarnedFees: string[];
  } | null;
  reinstatement: { lapse: boolean; cancelledOn: string } | null;
  note: string | null;
  approvedBy: string | null;
}

export function toTransactionDto(t: PolicyTransactionProps): TransactionDto {
  const d = t.details;
  const charges = d ? chargesOf(d) : [];

  const total = charges.reduce(
    (sum, line) => sum.plus(line.amount),
    t.premiumDelta.minus(t.premiumDelta),
  );

  const c = d?.cancellation;

  return {
    id: t.id,
    type: t.type,
    status: t.status,
    effectiveDate: t.effectiveDate.toString(),
    premiumDelta: money(t.premiumDelta),
    total: money(d ? total : t.premiumDelta),
    createdAt: t.createdAt.toString(),
    createdBy: t.createdBy?.name ?? null,
    issuedAt: t.issuedAt?.toString() ?? null,
    annualBefore: d ? money(d.annualBefore) : null,
    annualAfter: d ? money(d.annualAfter) : null,
    premium: (d?.premium ?? []).map((line) => ({
      coverage: line.coverage,
      ...(line.exposure !== undefined && { exposure: line.exposure }),
      name: line.name,
      before: money(line.before),
      after: money(line.after),
      amount: money(line.amount),
    })),
    retained: (d?.retained ?? []).map((line) => ({
      name: line.name,
      minimum: money(line.minimum),
      amount: money(line.amount),
    })),
    fees: (d?.fees ?? []).map((line) => ({
      code: line.code,
      label: line.label,
      amount: money(line.amount),
    })),
    changes: d?.changes ?? [],
    coverages: d?.after ? ((d.after.coverages ?? []) as PolicyDetailDto["coverages"]) : null,
    referrals: d?.referrals ?? [],
    cancellation: c
      ? {
          reason: c.reason,
          reasonLabel: c.reasonLabel,
          initiator: c.initiator,
          method: c.method,
          noticeDate: c.noticeDate,
          earliestDate: c.earliestDate,
          minDaysNotice: c.minDaysNotice,
          mailingDaysAdded: c.mailingDaysAdded,
          delivery: c.delivery,
          minimumEarned: c.minimumEarned && {
            type: c.minimumEarned.rule.type,
            value: c.minimumEarned.rule.value,
            level: c.minimumEarned.rule.level,
            minimum: money(c.minimumEarned.minimum),
            retained: money(c.minimumEarned.retained),
          },
          fullyEarnedFees: c.fullyEarnedFees,
        }
      : null,
    reinstatement: d?.reinstatement ?? null,
    note: d?.note ?? null,
    approvedBy: d?.approvedBy?.name ?? null,
  };
}

const agencyOf = (snapshot: Record<string, unknown> | undefined) => {
  const parties = snapshot?.parties as { producer?: { agency?: string } } | null | undefined;

  return parties?.producer?.agency?.trim() || null;
};

export function toPolicySummaryDto(policy: Policy): PolicySummaryDto {
  const { policy: p, versions } = policy.toSnapshot();
  const term = policy.currentTerm;

  const latest = versions
    .filter((v) => v.termId === term.id)
    .toSorted((a, b) => b.version - a.version)[0];

  return {
    id: p.id,
    number: p.number,
    insuredName: p.insuredName,
    productId: p.productId,
    productName: p.productName,
    producerId: p.producer.id,
    producerName: p.producer.name,
    producerAgency: p.producer.agencyName ?? agencyOf(latest?.snapshot),
    agencyId: p.producer.agencyId,
    jurisdiction: term.jurisdiction,
    effectiveDate: term.effectiveDate.toString(),
    expirationDate: term.expirationDate.toString(),
    status: term.status,
    cancellation: term.cancellation && {
      ...term.cancellation,
      effectiveDate: term.cancellation.effectiveDate.toString(),
    },
    annualPremium: money(annualOf(latest?.snapshot ?? {}, term.writtenPremium.currency)),
    writtenPremium: money(term.writtenPremium),
    taxesAndFees: money(term.taxesAndFees),
    total: money(term.writtenPremium.plus(term.taxesAndFees)),
    boundAt: term.boundAt.toString(),
  };
}

export function toPolicyDetailDto(policy: Policy): PolicyDetailDto {
  const state = policy.toSnapshot();
  const term = policy.currentTerm;
  const latest = policy.latestVersion(term.id);

  const coverages = coveragesOf(latest.snapshot).map((c) => ({
    coverage: c.coverage,
    name: c.name,
    ...(c.exposure !== undefined && { exposure: c.exposure }),
    ...(c.limit !== undefined && { limit: c.limit }),
    ...(c.deductible !== undefined && { deductible: c.deductible }),
    premium: money(c.premium),
  }));

  const open = policy.openTransaction(term.id);

  return {
    ...toPolicySummaryDto(policy),
    sourceSubmissionId: state.policy.sourceSubmissionId,
    productVersion: term.productVersion,
    coverages,
    transactions: state.transactions.filter((t) => t.status !== "discarded").map(toTransactionDto),
    openTransaction: open && toTransactionDto(open),
    financials: state.financials.map((f) => ({
      id: f.id,
      kind: f.kind,
      code: f.code,
      label: f.label,
      ...(f.coverage && { coverage: f.coverage }),
      ...(f.exposure && { exposure: f.exposure }),
      ...(f.remitter && { remitter: f.remitter }),
      amount: money(f.amount),
      effectiveDate: f.effectiveDate.toString(),
      recordedAt: f.recordedAt.toString(),
    })),
    documents: state.documents.map((d) => ({
      id: d.id,
      kind: d.kind,
      title: d.title,
      sizeBytes: d.sizeBytes,
      createdAt: d.createdAt.toString(),
    })),
    activatedAt: term.activatedAt?.toString() ?? null,
    events: state.events
      .toSorted((a, b) => Temporal.Instant.compare(b.occurredAt, a.occurredAt))
      .map((e) => ({
        id: e.id,
        type: e.type,
        category: e.category,
        occurredAt: e.occurredAt.toString(),
        effectiveDate: e.effectiveDate?.toString() ?? null,
        actor: e.actor,
        summary: e.summary,
        data: e.data,
        transactionId: e.transactionId,
        invoiceId: e.invoiceId,
      })),
  };
}
