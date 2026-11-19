import { type Id, type Instant, invalid, type Money, type TenantId } from "@pas/kernel";

export type AgencyId = Id<"Agency">;

export const AGENCY_STATUSES = ["active", "suspended", "terminated"] as const;
export type AgencyStatus = (typeof AGENCY_STATUSES)[number];

export interface AgencyAddress {
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}

export const REMITTANCE_BASES = ["gross", "net"] as const;
export type RemittanceBasis = (typeof REMITTANCE_BASES)[number];

/** Agency-bill eligibility and terms; billing reads them when it bills through the agency. */
export interface AgencyBilling {
  eligible: boolean;
  remittanceDays: number | null;
  creditLimit: Money | null;
  remittanceBasis: RemittanceBasis;
  /** Account current cut-off day of month; null is the month end. */
  statementDay: number | null;
  reminderDays: number | null;
  suspendAfterDays: number | null;
  /** Lets aging start nonpayment on the statement's unpaid items, instead of only suspending. */
  nonpaymentCancels: boolean;
  suspension: { at: Instant; reason: string } | null;
}

/** Agency bill is offered when the agency is eligible, active and not suspended for aging. */
export const mayAgencyBill = (agency: Pick<Agency, "status" | "billing">) =>
  agency.status === "active" && agency.billing.eligible && agency.billing.suspension === null;

export interface Agency {
  id: AgencyId;
  tenantId: TenantId;
  parentId: AgencyId | null;
  name: string;
  legalName: string | null;
  fein: string | null;
  address: AgencyAddress | null;
  phone: string | null;
  email: string | null;
  status: AgencyStatus;
  tier: string;
  billing: AgencyBilling;
  createdAt: Instant;
  updatedAt: Instant;
}

/** The given agencies and every agency below them, each once. */
export function withDescendants(
  agencies: readonly Pick<Agency, "id" | "parentId">[],
  roots: readonly string[],
): string[] {
  const children = new Map<string, string[]>();

  for (const agency of agencies) {
    if (!agency.parentId) continue;

    children.set(agency.parentId, [...(children.get(agency.parentId) ?? []), agency.id]);
  }

  const seen = new Set<string>();
  const queue = [...roots];

  while (queue.length > 0) {
    const id = queue.shift()!;

    if (seen.has(id)) continue;

    seen.add(id);
    queue.push(...(children.get(id) ?? []));
  }

  return [...seen];
}

/** A parent can't be the agency itself or one of its own sub-agencies. */
export function assertParent(
  agencies: readonly Pick<Agency, "id" | "parentId">[],
  agencyId: string,
  parentId: string | null,
): void {
  if (!parentId) return;

  if (!agencies.some((a) => a.id === parentId)) throw invalid("The parent agency doesn't exist");

  if (withDescendants(agencies, [agencyId]).includes(parentId)) {
    throw invalid("An agency can't sit under itself or one of its sub-agencies");
  }
}
