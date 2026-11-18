export { AppHosts } from "./domain/hosts";
export { DEFAULT_PRIMARY_COLOR } from "./domain/tenant-profile";
export { makeGetProfile, type GetProfile } from "./application/get-profile";
export {
  makeUpdateProfile,
  type UpdateProfile,
  type UpdateProfileInput,
} from "./application/update-profile";
export {
  makeResolveTenantByHost,
  type ResolveTenantByHost,
  type ResolveTenantInput,
  type ResolvedTenant,
} from "./application/resolve-tenant-by-host";
export { makeListTenants, type ListTenants, type PlatformActor } from "./application/list-tenants";
export type { TenantBrandingDto, TenantProfileDto, TenantSummaryDto } from "./application/dto";
export type { TenantDirectory } from "./ports/tenant-directory";
export type { TenantProfileRepository } from "./ports/tenant-profile-repository";
