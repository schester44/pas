import type { InvoiceDto } from "@pas/billing";
import type { PolicyDetailDto, PolicySummaryDto } from "@pas/policy";
import { isClientVisibleEvent } from "../domain/timeline";

type MoneyDto = { amount: string; currency: string };

export interface ClientAgentDto {
  name: string;
  agency: string | null;
  email: string | null;
}

export interface ClientPolicySummaryDto {
  id: string;
  number: string;
  productName: string;
  insuredName: string;
  status: PolicySummaryDto["status"];
  jurisdiction: PolicySummaryDto["jurisdiction"];
  effectiveDate: string;
  expirationDate: string;
  premium: MoneyDto;
  agent: ClientAgentDto;
}

export interface ClientPolicyDetailDto extends ClientPolicySummaryDto {
  writtenPremium: MoneyDto;
  taxesAndFees: MoneyDto;
  coverages: {
    name: string;
    exposure?: string;
    limit?: unknown;
    deductible?: unknown;
    premium: MoneyDto;
  }[];
  documents: { id: string; title: string; sizeBytes: number; createdAt: string }[];
  timeline: { id: string; type: string; category: string; occurredAt: string; summary: string }[];
  invoices: ClientInvoiceDto[];
  changeRequests: {
    id: string;
    kind: string;
    details: string;
    status: string;
    createdAt: string;
  }[];
}

export interface ClientInvoiceDto {
  id: string;
  number: string;
  kind: InvoiceDto["kind"];
  policyId: string;
  policyNumber: string;
  status: string;
  issuedOn: string;
  dueOn: string;
  total: MoneyDto;
  balance: MoneyDto;
  lines: { label: string; amount: MoneyDto }[];
}

export type AgentContacts = Map<string, { name: string; email: string | null }>;

export function toClientPolicySummary(
  policy: PolicySummaryDto,
  agents: AgentContacts,
): ClientPolicySummaryDto {
  return {
    id: policy.id,
    number: policy.number,
    productName: policy.productName,
    insuredName: policy.insuredName,
    status: policy.status,
    jurisdiction: policy.jurisdiction,
    effectiveDate: policy.effectiveDate,
    expirationDate: policy.expirationDate,
    premium: policy.total,
    agent: {
      name: agents.get(policy.producerId)?.name ?? policy.producerName,
      agency: policy.producerAgency,
      email: agents.get(policy.producerId)?.email ?? null,
    },
  };
}

export function toClientInvoice(invoice: InvoiceDto): ClientInvoiceDto {
  return {
    id: invoice.id,
    number: invoice.number,
    kind: invoice.kind,
    policyId: invoice.policyId,
    policyNumber: invoice.policyNumber,
    status: invoice.status,
    issuedOn: invoice.issuedOn,
    dueOn: invoice.dueOn,
    total: invoice.total,
    balance: invoice.balance,
    lines: invoice.lines.map((line) => ({ label: line.label, amount: line.amount })),
  };
}

export function toClientPolicyDetail(
  policy: PolicyDetailDto,
  agents: AgentContacts,
  extra: {
    invoices: InvoiceDto[];
    changeRequests: ClientPolicyDetailDto["changeRequests"];
  },
): ClientPolicyDetailDto {
  return {
    ...toClientPolicySummary(policy, agents),
    writtenPremium: policy.writtenPremium,
    taxesAndFees: policy.taxesAndFees,
    coverages: policy.coverages.map((c) => ({
      name: c.name,
      ...(c.exposure && { exposure: c.exposure }),
      ...(c.limit !== undefined && { limit: c.limit }),
      ...(c.deductible !== undefined && { deductible: c.deductible }),
      premium: c.premium,
    })),
    documents: policy.documents.map((d) => ({
      id: d.id,
      title: d.title,
      sizeBytes: d.sizeBytes,
      createdAt: d.createdAt,
    })),
    timeline: policy.events.filter(isClientVisibleEvent).map((e) => ({
      id: e.id,
      type: e.type,
      category: e.category,
      occurredAt: e.occurredAt,
      summary: e.summary,
    })),
    invoices: extra.invoices.map(toClientInvoice),
    changeRequests: extra.changeRequests,
  };
}
