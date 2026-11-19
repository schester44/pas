import type { Id, Instant, PlainDate, TenantId } from "@pas/kernel";
import type { AgencyId } from "./agency";

export type ProducerId = Id<"Producer">;

export const PRODUCER_STATUSES = ["invited", "active", "inactive"] as const;
export type ProducerStatus = (typeof PRODUCER_STATUSES)[number];

export type MembershipRole = "producer" | "admin";

export interface AgencyMembership {
  agencyId: AgencyId;
  role: MembershipRole;
  primary: boolean;
}

/** A person who sells; `userId` links the Better Auth member once they've joined the tenant. */
export interface Producer {
  id: ProducerId;
  tenantId: TenantId;
  userId: string | null;
  name: string;
  email: string;
  producerNumber: string | null;
  npn: string | null;
  status: ProducerStatus;
  memberships: AgencyMembership[];
  createdAt: Instant;
  updatedAt: Instant;
}

export const primaryAgencyOf = (producer: Pick<Producer, "memberships">): AgencyId | null =>
  (producer.memberships.find((m) => m.primary) ?? producer.memberships[0])?.agencyId ?? null;

export interface Appointment {
  id: string;
  agencyId: AgencyId | null;
  producerId: ProducerId | null;
  carrier: string;
  subdivision: string;
  country: string;
  status: "active" | "terminated";
  effectiveDate: PlainDate;
  terminatedDate: PlainDate | null;
  createdAt: Instant;
}
