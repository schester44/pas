import { asId, notFound, type TenantContext, type UnitOfWork } from "@pas/kernel";
import { coveragesOf } from "../domain/term-state";
import type { PolicyRepository } from "../ports/policy-repository";

type MoneyDto = { amount: string; currency: string };

export interface EvidenceOfInsuranceDto {
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
  mortgagees: { name: string; reference: string | null; address: unknown; email: string | null }[];
  coverages: {
    code: string;
    name: string;
    limit?: unknown;
    deductible?: unknown;
    premium: MoneyDto;
  }[];
  total: MoneyDto;
}

const isAddress = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Record<string, unknown>).line1 === "string" &&
  typeof (value as Record<string, unknown>).city === "string";

function addressesIn(value: unknown, key = ""): unknown[] {
  if (key === "mailingAddress") return [];

  if (isAddress(value)) return [value];

  if (Array.isArray(value)) return value.flatMap((item) => addressesIn(item));

  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([k, v]) => addressesIn(v, k));
  }

  return [];
}

/** What a lender's evidence of insurance and declarations show, from the latest term version. */
export function makeGetEvidenceOfInsurance(deps: { uow: UnitOfWork; policies: PolicyRepository }) {
  return async function getEvidenceOfInsurance(
    ctx: TenantContext,
    input: { policyId: string },
  ): Promise<EvidenceOfInsuranceDto> {
    const policy = await deps.uow.run(ctx, (tx) =>
      deps.policies.findById(tx, ctx, { kind: "tenant" }, asId(input.policyId)),
    );

    if (!policy) throw notFound("Policy", input.policyId);

    const p = policy.toSnapshot().policy;
    const term = policy.currentTerm;
    const snapshot = policy.latestVersion(term.id).snapshot;
    const risk = (snapshot.risk ?? {}) as Record<string, unknown>;

    const parties = (snapshot.parties ?? {}) as {
      mailingAddress?: unknown;
      additionalInterests?: {
        kind: string;
        name: string;
        reference?: string;
        address?: unknown;
        email?: string;
      }[];
    };

    return {
      policyNumber: p.number,
      productName: p.productName,
      productVersion: term.productVersion,
      effectiveDate: term.effectiveDate.toString(),
      expirationDate: term.expirationDate.toString(),
      jurisdiction: term.jurisdiction,
      insuredName: p.insuredName,
      mailingAddress: parties.mailingAddress ?? risk.mailingAddress ?? null,
      insuredLocations: addressesIn(risk),
      producer: {
        name: p.producer.name,
        ...(p.producer.agencyName && { agency: p.producer.agencyName }),
      },
      mortgagees: (parties.additionalInterests ?? [])
        .filter((i) => i.kind === "mortgagee" && i.name?.trim())
        .map((i) => ({
          name: i.name.trim(),
          reference: i.reference?.trim() || null,
          address: i.address ?? null,
          email: i.email?.trim() || null,
        })),
      coverages: coveragesOf(snapshot).map((c) => ({
        code: c.coverage,
        name: c.name,
        ...(c.limit !== undefined && { limit: c.limit }),
        ...(c.deductible !== undefined && { deductible: c.deductible }),
        premium: c.premium.toJSON(),
      })),
      total: term.writtenPremium.plus(term.taxesAndFees).toJSON(),
    };
  };
}

export type GetEvidenceOfInsurance = ReturnType<typeof makeGetEvidenceOfInsurance>;
