import type { AppHosts } from "../domain/hosts";
import type { TenantProfile } from "../domain/tenant-profile";

export interface TenantProfileDto {
  tenantId: string;
  displayName: string;
  primaryColor: string;
  logoUrl: string | null;
  appSubdomain: string;
  customDomains: string[];
  supportEmail: string | null;
  supportPhone: string | null;
  appUrls: string[];
  updatedAt: string;
}

export interface TenantBrandingDto {
  slug: string;
  displayName: string;
  primaryColor: string;
  logoUrl: string | null;
  supportEmail: string | null;
  supportPhone: string | null;
  sandbox: boolean;
}

export interface TenantSummaryDto {
  tenantId: string;
  name: string;
  slug: string;
  appSubdomain: string;
  customDomains: string[];
  primaryColor: string;
  memberCount: number;
  createdAt: string;
}

export function toTenantProfileDto(profile: TenantProfile, hosts: AppHosts): TenantProfileDto {
  const p = profile.toSnapshot();

  return {
    tenantId: p.tenantId,
    displayName: p.displayName,
    primaryColor: p.primaryColor,
    logoUrl: p.logoUrl,
    appSubdomain: p.appSubdomain,
    customDomains: p.customDomains,
    supportEmail: p.supportEmail,
    supportPhone: p.supportPhone,
    appUrls: hosts.urlsFor(p.appSubdomain, p.customDomains),
    updatedAt: p.updatedAt.toString(),
  };
}

export function toTenantBrandingDto(profile: TenantProfile, sandbox: boolean): TenantBrandingDto {
  const p = profile.toSnapshot();

  return {
    slug: p.appSubdomain,
    displayName: p.displayName,
    primaryColor: p.primaryColor,
    logoUrl: p.logoUrl,
    supportEmail: p.supportEmail,
    supportPhone: p.supportPhone,
    sandbox,
  };
}
