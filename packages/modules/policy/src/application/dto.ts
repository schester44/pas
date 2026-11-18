import type { Money } from "@pas/kernel";
import type { Policy, TermStatus } from "../domain/policy";

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
  jurisdiction: { country: string; subdivision?: string };
  effectiveDate: string;
  expirationDate: string;
  status: TermStatus;
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
  transactions: {
    id: string;
    type: string;
    status: string;
    effectiveDate: string;
    premiumDelta: MoneyDto;
    issuedAt: string;
  }[];
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

const agencyOf = (snapshot: Record<string, unknown> | undefined) => {
  const parties = snapshot?.parties as { producer?: { agency?: string } } | null | undefined;

  return parties?.producer?.agency?.trim() || null;
};

export function toPolicySummaryDto(policy: Policy): PolicySummaryDto {
  const { policy: p, versions } = policy.toSnapshot();
  const term = policy.firstTerm;
  const latest = versions.toSorted((a, b) => b.version - a.version)[0];

  return {
    id: p.id,
    number: p.number,
    insuredName: p.insuredName,
    productId: p.productId,
    productName: p.productName,
    producerId: p.producer.id,
    producerName: p.producer.name,
    producerAgency: agencyOf(latest?.snapshot),
    jurisdiction: term.jurisdiction,
    effectiveDate: term.effectiveDate.toString(),
    expirationDate: term.expirationDate.toString(),
    status: term.status,
    writtenPremium: money(term.writtenPremium),
    taxesAndFees: money(term.taxesAndFees),
    total: money(term.writtenPremium.plus(term.taxesAndFees)),
    boundAt: term.boundAt.toString(),
  };
}

export function toPolicyDetailDto(policy: Policy): PolicyDetailDto {
  const state = policy.toSnapshot();
  const term = policy.firstTerm;
  const latest = state.versions.toSorted((a, b) => b.version - a.version)[0];
  const coverages = (latest?.snapshot.coverages ?? []) as PolicyDetailDto["coverages"];

  return {
    ...toPolicySummaryDto(policy),
    sourceSubmissionId: state.policy.sourceSubmissionId,
    productVersion: term.productVersion,
    coverages,
    transactions: state.transactions.map((t) => ({
      id: t.id,
      type: t.type,
      status: t.status,
      effectiveDate: t.effectiveDate.toString(),
      premiumDelta: money(t.premiumDelta),
      issuedAt: t.issuedAt.toString(),
    })),
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
