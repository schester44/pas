export {
  makeManageAgencies,
  type ManageAgencies,
  type SaveAgencyInput,
} from "./application/manage-agencies";
export {
  makeManageProducers,
  type InviteProducerInput,
  type ManageProducers,
  type SaveAppointmentInput,
  type SaveLicenseInput,
  type SaveProducerInput,
} from "./application/manage-producers";
export {
  makeManageRules,
  type ManageRules,
  type SaveScheduleInput,
} from "./application/manage-rules";
export { makeResolveBookScope, type ResolveBookScope } from "./application/resolve-book-scope";
export {
  makeProducerOfRecord,
  type ProducerOfRecord,
  type ProducerOfRecordLookup,
} from "./application/producer-of-record";
export {
  makeCheckProducerLicense,
  type CheckProducerLicense,
  type LicensingResult,
} from "./application/check-producer-license";
export { makeRecordCommissions, type RecordCommissions } from "./application/record-commissions";
export { makeCommissionFacts, type CommissionFacts } from "./application/commission-facts";
export {
  makeAgencyStatement,
  type AgencyStatement,
  type AgencyStatementDto,
} from "./application/agency-statement";
export type { DistributionDeps } from "./application/deps";
export type {
  AgencyDetailDto,
  AgencyDto,
  AppointmentDto,
  CommissionDto,
  CommissionScheduleDto,
  LicenseDto,
  ProducerDetailDto,
  ProducerDto,
} from "./application/dto";
export { AGENCY_STATUSES, type AgencyAddress, type AgencyStatus } from "./domain/agency";
export { PRODUCER_STATUSES, type MembershipRole, type ProducerStatus } from "./domain/producer";
export type { BookReach } from "./domain/book-scope";
export type { Business } from "./domain/commission";
export type { LicenseHealth, LicensingMode } from "./domain/license";
export type { LicensingRequirement } from "./ports/commission-repository";
export type {
  LicenseRecord,
  ProducerLicenseLookup,
  ProducerLicensing,
} from "./ports/producer-licensing";
export type { PolicyFinancials, TransactionFinancials } from "./ports/policy-financials";
export type { MemberDirectory } from "./ports/member-directory";
export {
  makeAgencyBilling,
  type AgencyBilling,
  type AgencyBillingTerms,
} from "./application/agency-billing";
export {
  COMMISSION_BASES,
  type CommissionBasis,
  REMITTANCE_BASES,
  type RemittanceBasis,
} from "./domain/agency";
