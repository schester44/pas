import type { Money, PlainDate } from "@pas/kernel";
import type {
  Agency,
  AgencyAddress,
  AgencyStatus,
  CommissionBasis,
  RemittanceBasis,
} from "../domain/agency";
import type { Business, CommissionSchedule } from "../domain/commission";
import { type License, type LicenseHealth, licenseHealth } from "../domain/license";
import type { Appointment, MembershipRole, Producer, ProducerStatus } from "../domain/producer";
import type { CommissionRecord } from "../ports/commission-repository";
import { LICENSE_WARN_DAYS } from "./deps";

type MoneyDto = { amount: string; currency: string };

const money = (value: Money): MoneyDto => value.toJSON();

export interface AgencyDto {
  id: string;
  parentId: string | null;
  parentName: string | null;
  name: string;
  legalName: string | null;
  fein: string | null;
  address: AgencyAddress | null;
  phone: string | null;
  email: string | null;
  status: AgencyStatus;
  tier: string;
  billing: {
    eligible: boolean;
    remittanceDays: number | null;
    creditLimit: MoneyDto | null;
    remittanceBasis: RemittanceBasis;
    commissionBasis: CommissionBasis | null;
    statementDay: number | null;
    reminderDays: number | null;
    suspendAfterDays: number | null;
    nonpaymentCancels: boolean;
    suspension: { at: string; reason: string } | null;
  };
  producerCount: number;
  subAgencyCount: number;
  licenseWarnings: number;
}

export interface LicenseDto {
  id: string;
  producerId: string;
  npn: string;
  country: string;
  subdivision: string;
  licenseNumber: string;
  linesOfAuthority: string[];
  effectiveDate: string;
  expirationDate: string | null;
  status: License["status"];
  source: License["source"];
  health: LicenseHealth;
}

export interface AppointmentDto {
  id: string;
  agencyId: string | null;
  producerId: string | null;
  carrier: string;
  country: string;
  subdivision: string;
  status: Appointment["status"];
  effectiveDate: string;
  terminatedDate: string | null;
}

export interface ProducerDto {
  id: string;
  userId: string | null;
  name: string;
  email: string;
  producerNumber: string | null;
  npn: string | null;
  status: ProducerStatus;
  memberships: { agencyId: string; agencyName: string; role: MembershipRole; primary: boolean }[];
  licenses: LicenseDto[];
}

export interface ProducerDetailDto extends ProducerDto {
  appointments: AppointmentDto[];
}

export interface AgencyDetailDto extends AgencyDto {
  parent: { id: string; name: string } | null;
  children: { id: string; name: string; status: AgencyStatus; producerCount: number }[];
  producers: ProducerDto[];
  appointments: AppointmentDto[];
}

export interface CommissionScheduleDto {
  id: string;
  productId: string | null;
  country: string;
  subdivision: string | null;
  business: Business | null;
  tier: string | null;
  rate: string;
  effectiveDate: string;
  expirationDate: string | null;
}

export interface CommissionDto {
  id: string;
  financialTransactionId: string;
  transactionId: string;
  transactionType: string;
  policyId: string;
  policyNumber: string;
  insuredName: string;
  agencyId: string | null;
  producerId: string;
  business: Business;
  premium: MoneyDto;
  rate: string;
  amount: MoneyDto;
  effectiveDate: string;
  recordedAt: string;
}

const dateOrNull = (d: PlainDate | null) => d?.toString() ?? null;

export function toAgencyDto(
  agency: Agency,
  context: {
    agencies: readonly Agency[];
    producers: readonly Producer[];
    licenses: readonly License[];
    today: PlainDate;
  },
): AgencyDto {
  const producers = context.producers.filter((p) =>
    p.memberships.some((m) => m.agencyId === agency.id),
  );

  const producerIds = new Set<string>(producers.map((p) => p.id));

  const warnings = context.licenses.filter(
    (l) =>
      producerIds.has(l.producerId) &&
      licenseHealth(l, context.today, LICENSE_WARN_DAYS) !== "current",
  );

  return {
    id: agency.id,
    parentId: agency.parentId,
    parentName: context.agencies.find((a) => a.id === agency.parentId)?.name ?? null,
    name: agency.name,
    legalName: agency.legalName,
    fein: agency.fein,
    address: agency.address,
    phone: agency.phone,
    email: agency.email,
    status: agency.status,
    tier: agency.tier,
    billing: {
      eligible: agency.billing.eligible,
      remittanceDays: agency.billing.remittanceDays,
      creditLimit: agency.billing.creditLimit && money(agency.billing.creditLimit),
      remittanceBasis: agency.billing.remittanceBasis,
      commissionBasis: agency.billing.commissionBasis,
      statementDay: agency.billing.statementDay,
      reminderDays: agency.billing.reminderDays,
      suspendAfterDays: agency.billing.suspendAfterDays,
      nonpaymentCancels: agency.billing.nonpaymentCancels,
      suspension: agency.billing.suspension && {
        at: agency.billing.suspension.at.toString(),
        reason: agency.billing.suspension.reason,
      },
    },
    producerCount: producers.length,
    subAgencyCount: context.agencies.filter((a) => a.parentId === agency.id).length,
    licenseWarnings: warnings.length,
  };
}

export const toLicenseDto = (license: License, today: PlainDate): LicenseDto => ({
  id: license.id,
  producerId: license.producerId,
  npn: license.npn,
  country: license.country,
  subdivision: license.subdivision,
  licenseNumber: license.licenseNumber,
  linesOfAuthority: license.linesOfAuthority,
  effectiveDate: license.effectiveDate.toString(),
  expirationDate: dateOrNull(license.expirationDate),
  status: license.status,
  source: license.source,
  health: licenseHealth(license, today, LICENSE_WARN_DAYS),
});

export const toAppointmentDto = (a: Appointment): AppointmentDto => ({
  id: a.id,
  agencyId: a.agencyId,
  producerId: a.producerId,
  carrier: a.carrier,
  country: a.country,
  subdivision: a.subdivision,
  status: a.status,
  effectiveDate: a.effectiveDate.toString(),
  terminatedDate: dateOrNull(a.terminatedDate),
});

export function toProducerDto(
  producer: Producer,
  context: { agencies: readonly Agency[]; licenses: readonly License[]; today: PlainDate },
): ProducerDto {
  return {
    id: producer.id,
    userId: producer.userId,
    name: producer.name,
    email: producer.email,
    producerNumber: producer.producerNumber,
    npn: producer.npn,
    status: producer.status,
    memberships: producer.memberships.map((m) => ({
      agencyId: m.agencyId,
      agencyName: context.agencies.find((a) => a.id === m.agencyId)?.name ?? "",
      role: m.role,
      primary: m.primary,
    })),
    licenses: context.licenses
      .filter((l) => l.producerId === producer.id)
      .toSorted((a, b) => a.subdivision.localeCompare(b.subdivision))
      .map((l) => toLicenseDto(l, context.today)),
  };
}

export const toScheduleDto = (s: CommissionSchedule): CommissionScheduleDto => ({
  id: s.id,
  productId: s.productId,
  country: s.country,
  subdivision: s.subdivision,
  business: s.business,
  tier: s.tier,
  rate: s.rate,
  effectiveDate: s.effectiveDate.toString(),
  expirationDate: dateOrNull(s.expirationDate),
});

export const toCommissionDto = (c: CommissionRecord): CommissionDto => ({
  id: c.id,
  financialTransactionId: c.financialTransactionId,
  transactionId: c.transactionId,
  transactionType: c.transactionType,
  policyId: c.policyId,
  policyNumber: c.policyNumber,
  insuredName: c.insuredName,
  agencyId: c.agencyId,
  producerId: c.producerId,
  business: c.business,
  premium: money(c.premium),
  rate: c.rate,
  amount: money(c.amount),
  effectiveDate: c.effectiveDate.toString(),
  recordedAt: c.recordedAt.toString(),
});
