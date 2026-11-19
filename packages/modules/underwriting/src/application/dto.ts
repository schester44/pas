import { type Instant, jurisdictionCode, type Money } from "@pas/kernel";
import type { AuthorityProfile } from "../domain/authority";
import type { Inspection } from "../domain/inspection";
import type { Referral, ReferralEntry } from "../domain/referral";
import { isOverdue, type Subjectivity } from "../domain/subjectivity";

export interface MoneyDto {
  amount: string;
  currency: string;
}

const money = (value: Money): MoneyDto => value.toJSON();

export interface EntryDto {
  id: string;
  kind: ReferralEntry["kind"];
  visibility: ReferralEntry["visibility"];
  action: string | null;
  author: { id: string | null; name: string; role: string };
  body: string;
  data: Record<string, unknown>;
  at: string;
}

export interface ReferralSummaryDto {
  id: string;
  quoteId: string;
  submissionId: string;
  submissionNumber: string;
  productId: string;
  productName: string;
  jurisdiction: string;
  insuredName: string | null;
  producer: { id: string | null; name: string; agencyId: string | null };
  status: string;
  reasons: { reasonCode: string; message: string; authority?: string }[];
  requiredLevel: number;
  requiredAuthority: string | null;
  assignee: { id: string | null; name: string } | null;
  writtenPremium: MoneyDto;
  total: MoneyDto;
  insuredValue: MoneyDto;
  dueAt: string;
  overdue: boolean;
  openedAt: string;
  updatedAt: string;
}

export interface ReferralDetailDto extends ReferralSummaryDto {
  reasons: {
    reasonCode: string;
    message: string;
    outcome: "refer" | "decline" | "info_needed";
    authority?: string;
    internalMessage?: string;
    decision?: string;
    rule?: string;
  }[];
  quoteRevision: number;
  escalation: { level: number; problems: string[]; by: string; at: string } | null;
  decision: {
    outcome: "approved" | "declined";
    by: string;
    at: string;
    note: string | null;
    changes: Record<string, unknown>;
  } | null;
  entries: EntryDto[];
}

const entryDto = (e: ReferralEntry): EntryDto => ({
  id: e.id,
  kind: e.kind,
  visibility: e.visibility,
  action: e.action ?? null,
  author: e.author,
  body: e.body,
  data: e.data,
  at: e.at.toString(),
});

export function toReferralSummary(
  referral: Referral,
  profiles: readonly AuthorityProfile[],
  now: Instant,
): ReferralSummaryDto {
  const r = referral.toSnapshot();

  const authority = profiles
    .filter((p) => p.level >= r.requiredLevel)
    .toSorted((a, b) => a.level - b.level)[0];

  return {
    id: r.id,
    quoteId: r.quoteId,
    submissionId: r.submissionId,
    submissionNumber: r.submissionNumber,
    productId: r.productId,
    productName: r.productName,
    jurisdiction: jurisdictionCode(r.jurisdiction),
    insuredName: r.insuredName,
    producer: r.producer,
    status: r.status,
    reasons: r.quote.reasons.map((x) => ({
      reasonCode: x.reasonCode,
      message: x.message,
      ...(x.authority && { authority: x.authority }),
    })),
    requiredLevel: r.requiredLevel,
    requiredAuthority: authority?.name ?? null,
    assignee: r.assignee,
    writtenPremium: money(r.quote.writtenPremium),
    total: money(r.quote.total),
    insuredValue: money(r.quote.insuredValue),
    dueAt: r.quote.dueAt.toString(),
    overdue: referral.isOpen && Temporal.Instant.compare(now, r.quote.dueAt) > 0,
    openedAt: r.openedAt.toString(),
    updatedAt: r.updatedAt.toString(),
  };
}

export function toReferralDetail(
  referral: Referral,
  profiles: readonly AuthorityProfile[],
  now: Instant,
): ReferralDetailDto {
  const r = referral.toSnapshot();

  return {
    ...toReferralSummary(referral, profiles, now),
    reasons: r.quote.reasons,
    quoteRevision: r.quote.revision,
    escalation: r.escalation && {
      level: r.escalation.level,
      problems: r.escalation.problems,
      by: r.escalation.by.name,
      at: r.escalation.at.toString(),
    },
    decision: r.decision && {
      outcome: r.decision.outcome,
      by: r.decision.by.name,
      at: r.decision.at.toString(),
      note: r.decision.note,
      changes: r.decision.changes,
    },
    entries: r.entries.map(entryDto),
  };
}

export interface ProducerReferralDto {
  id: string;
  status: string;
  dueAt: string;
  waitingOnProducer: boolean;
  messages: EntryDto[];
}

/** The producer's side: status and the conversation, never internal notes. */
export function toProducerReferral(referral: Referral): ProducerReferralDto {
  const r = referral.toSnapshot();

  return {
    id: r.id,
    status: r.status === "escalated" ? "open" : r.status,
    dueAt: r.quote.dueAt.toString(),
    waitingOnProducer: r.status === "info_requested",
    messages: r.entries.filter((e) => e.visibility === "producer").map(entryDto),
  };
}

export interface SubjectivityDto {
  id: string;
  quoteId: string;
  submissionId: string;
  submissionNumber: string;
  policyId: string | null;
  policyNumber: string | null;
  code: string;
  title: string;
  description: string | null;
  timing: string;
  dueDays: number | null;
  dueDate: string | null;
  owner: string;
  source: string;
  consequence: string | null;
  status: string;
  overdue: boolean;
  documents: {
    key: string;
    name: string;
    sizeBytes: number;
    uploadedBy: string;
    uploadedAt: string;
  }[];
  history: { id: string; type: string; at: string; actor: string; summary: string }[];
  createdAt: string;
}

export function toSubjectivityDto(
  subjectivity: Subjectivity,
  today: Temporal.PlainDate,
): SubjectivityDto {
  const s = subjectivity.toSnapshot();

  return {
    id: s.id,
    quoteId: s.quoteId,
    submissionId: s.submissionId,
    submissionNumber: s.submissionNumber,
    policyId: s.policyId,
    policyNumber: s.policyNumber,
    code: s.code,
    title: s.title,
    description: s.description,
    timing: s.timing,
    dueDays: s.dueDays,
    dueDate: s.dueDate?.toString() ?? null,
    owner: s.owner,
    source: s.source,
    consequence: s.consequence,
    status: s.status,
    overdue: s.overdueAt !== null || isOverdue(s, today),
    documents: s.documents.map((d) => ({
      key: d.key,
      name: d.name,
      sizeBytes: d.sizeBytes,
      uploadedBy: d.uploadedBy.name,
      uploadedAt: d.uploadedAt.toString(),
    })),
    history: s.history.map((h) => ({
      id: h.id,
      type: h.type,
      at: h.at.toString(),
      actor: h.actor.name,
      summary: h.summary,
    })),
    createdAt: s.createdAt.toString(),
  };
}

export interface InspectionDto {
  id: string;
  quoteId: string;
  submissionId: string;
  submissionNumber: string;
  policyId: string | null;
  policyNumber: string | null;
  code: string;
  type: string;
  timing: string;
  reason: string;
  address: string;
  providerId: string | null;
  providerRef: string | null;
  status: string;
  needsReview: boolean;
  scheduledFor: string | null;
  completedAt: string | null;
  report: {
    summary: string;
    imageryOnly: boolean;
    findings: {
      code: string;
      label: string;
      severity: string;
      detail: string;
      source: string;
      recommendation?: { code: string; title: string; dueDays: number };
    }[];
    photos: { caption: string; url: string | null }[];
  } | null;
  review: {
    outcome: string;
    note: string | null;
    by: string;
    at: string;
    subjectivityCodes: string[];
  } | null;
  history: { id: string; status: string; at: string; summary: string }[];
  createdAt: string;
}

export function toInspectionDto(inspection: Inspection): InspectionDto {
  const s = inspection.toSnapshot();
  const a = s.address;
  const findings = s.report?.findings ?? [];

  return {
    id: s.id,
    quoteId: s.quoteId,
    submissionId: s.submissionId,
    submissionNumber: s.submissionNumber,
    policyId: s.policyId,
    policyNumber: s.policyNumber,
    code: s.code,
    type: s.type,
    timing: s.timing,
    reason: s.reason,
    address: [a.line1, a.line2, `${a.city}, ${a.region} ${a.postalCode}`]
      .filter(Boolean)
      .join(", "),
    providerId: s.providerId,
    providerRef: s.providerRef,
    status: s.status,
    needsReview: s.status === "completed",
    scheduledFor: s.scheduledFor?.toString() ?? null,
    completedAt: s.completedAt?.toString() ?? null,
    report: s.report && {
      ...s.report,
      imageryOnly: findings.length > 0 && findings.every((f) => f.source === "imagery"),
    },
    review: s.review && {
      outcome: s.review.outcome,
      note: s.review.note,
      by: s.review.by.name,
      at: s.review.at.toString(),
      subjectivityCodes: s.review.subjectivityCodes,
    },
    history: s.history.map((h) => ({ ...h, at: h.at.toString() })),
    createdAt: s.createdAt.toString(),
  };
}
