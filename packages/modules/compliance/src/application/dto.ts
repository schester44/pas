import { type Instant, jurisdictionCode } from "@pas/kernel";
import type { Obligation } from "../domain/obligation";
import type { FilingRequest } from "../ports/filing-channel";

export type ObligationState = "due" | "overdue" | "rejected" | "submitted" | "done" | "waived";

export interface ObligationSummaryDto {
  id: string;
  kind: string;
  code: string;
  title: string;
  status: string;
  state: ObligationState;
  overdue: boolean;
  jurisdiction: string;
  dueDate: string;
  lateFrom: string;
  channel: string;
  escalation: number;
  responsible: {
    type: string;
    name: string;
    licenseeId: string | null;
    licenseNumber: string | null;
  };
  subject: {
    type: string;
    policyId: string | null;
    policyNumber: string | null;
    transactionId: string | null;
    transactionType: string | null;
    periodStart: string | null;
    periodEnd: string | null;
  };
  insuredName: string | null;
  filingNumber: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ObligationDetailDto extends ObligationSummaryDto {
  rule: { days: number; from: string; businessDays: boolean };
  data: Record<string, unknown>;
  source: { releaseId: string | null; decision: string };
  proof: {
    filingNumber: string | null;
    stampNumber: string | null;
    note: string | null;
    files: { key: string; name: string; sizeBytes: number }[];
    recordedAt: string;
  } | null;
  waiver: { reason: string; approver: string; waivedAt: string } | null;
  filings: {
    id: string;
    attempt: number;
    providerId: string;
    delivery: string;
    reference: string | null;
    batchId: string | null;
    status: string;
    filingNumber: string | null;
    stampNumber: string | null;
    reasons: string[];
    submittedAt: string;
    respondedAt: string | null;
  }[];
  events: { id: string; type: string; occurredAt: string; actor: string; summary: string }[];
  request: FilingRequest;
}

export function stateOf(o: Obligation, now: Instant): ObligationState {
  const s = o.toSnapshot();

  if (o.isOverdue(now)) return "overdue";

  switch (s.status) {
    case "rejected":
      return "rejected";
    case "submitted":
      return "submitted";
    case "accepted":
    case "completed":
      return "done";
    case "waived":
      return "waived";
    default:
      return "due";
  }
}

export function toSummaryDto(o: Obligation, now: Instant): ObligationSummaryDto {
  const s = o.toSnapshot();

  return {
    id: s.id,
    kind: s.kind,
    code: s.code,
    title: s.title,
    status: s.status,
    state: stateOf(o, now),
    overdue: o.isOverdue(now),
    jurisdiction: jurisdictionCode(s.jurisdiction),
    dueDate: s.dueDate.toString(),
    lateFrom: s.lateFrom.toString(),
    channel: s.channel,
    escalation: s.escalation,
    responsible: {
      type: s.responsible.type,
      name: s.responsible.name,
      licenseeId: s.responsible.licensee?.id ?? null,
      licenseNumber: s.responsible.licensee?.licenseNumber ?? null,
    },
    subject: { ...s.subject },
    insuredName: typeof s.data.insuredName === "string" ? s.data.insuredName : null,
    filingNumber: s.proof?.filingNumber ?? null,
    createdAt: s.createdAt.toString(),
    updatedAt: s.updatedAt.toString(),
  };
}

type Money = { amount: string; currency: string };

/** What a channel is given for this obligation; the detail page shows it before submitting. */
export function filingRequestOf(o: Obligation, correction: string | null = null): FilingRequest {
  const s = o.toSnapshot();
  const d = s.data as Record<string, unknown>;
  const text = (key: string) => (typeof d[key] === "string" ? (d[key] as string) : null);

  const taxes =
    (d.taxesFees as { code: string; label: string; remitter: string | null; amount: Money }[]) ??
    [];

  return {
    obligationId: s.id,
    attempt: s.filings.length + 1,
    kind: s.kind,
    code: s.code,
    title: s.title,
    jurisdiction: jurisdictionCode(s.jurisdiction),
    policyNumber: s.subject.policyNumber,
    transactionType: s.subject.transactionType,
    effectiveDate: text("effectiveDate"),
    expirationDate: text("expirationDate"),
    issuedDate: text("issuedDate"),
    insuredName: text("insuredName"),
    premium: (d.premium as Money | undefined) ?? null,
    taxesFees: taxes
      .filter((t) => t.remitter === "licensee")
      .map(({ code, label, amount }) => ({ code, label, amount })),
    licensee: s.responsible.licensee && {
      name: s.responsible.licensee.name,
      licenseNumber: s.responsible.licensee.licenseNumber,
      jurisdiction: s.responsible.licensee.jurisdiction,
    },
    period:
      s.subject.periodStart && s.subject.periodEnd
        ? { start: s.subject.periodStart, end: s.subject.periodEnd }
        : null,
    correction,
    data: d,
  };
}

export function toDetailDto(o: Obligation, now: Instant): ObligationDetailDto {
  const s = o.toSnapshot();
  const lastCorrection = s.events.findLast((e) => e.type === "corrected")?.summary ?? null;

  return {
    ...toSummaryDto(o, now),
    rule: { days: s.rule.days, from: s.rule.from, businessDays: s.rule.businessDays },
    data: s.data,
    source: s.source,
    proof: s.proof && {
      filingNumber: s.proof.filingNumber,
      stampNumber: s.proof.stampNumber,
      note: s.proof.note,
      files: s.proof.files.map((f) => ({ key: f.key, name: f.name, sizeBytes: f.sizeBytes })),
      recordedAt: s.proof.recordedAt.toString(),
    },
    waiver: s.waiver && {
      reason: s.waiver.reason,
      approver: s.waiver.approver.name,
      waivedAt: s.waiver.waivedAt.toString(),
    },
    filings: s.filings.map((f) => ({
      ...f,
      submittedAt: f.submittedAt.toString(),
      respondedAt: f.respondedAt?.toString() ?? null,
    })),
    events: s.events
      .map((e) => ({
        id: e.id,
        type: e.type,
        occurredAt: e.occurredAt.toString(),
        actor: e.actor.name,
        summary: e.summary,
      }))
      .toReversed(),
    request: filingRequestOf(o, s.status === "corrected" ? lastCorrection : null),
  };
}
