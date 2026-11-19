import { instantFromDb } from "@pas/db";
import { asId } from "@pas/kernel";
import { type OrganizationRef, TenantProfile } from "../domain/tenant-profile";

export interface ProfileRow {
  id: string;
  tenantId: string;
  displayName: string;
  primaryColor: string;
  logoUrl: string | null;
  appSubdomain: string;
  supportEmail: string | null;
  supportPhone: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toProfile(
  row: ProfileRow,
  domains: readonly { hostname: string }[],
): TenantProfile {
  return TenantProfile.restore({
    id: asId(row.id),
    tenantId: asId(row.tenantId),
    displayName: row.displayName,
    primaryColor: row.primaryColor,
    logoUrl: row.logoUrl,
    appSubdomain: row.appSubdomain,
    customDomains: domains.map((d) => d.hostname).toSorted(),
    supportEmail: row.supportEmail,
    supportPhone: row.supportPhone,
    createdAt: instantFromDb(row.createdAt),
    updatedAt: instantFromDb(row.updatedAt),
  });
}

export function toOrganizationRef(row: {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
}): OrganizationRef {
  return {
    id: asId(row.id),
    name: row.name,
    slug: row.slug,
    createdAt: instantFromDb(row.createdAt),
  };
}
