import type { OrganizationRef, TenantProfile } from "../domain/tenant-profile";

export interface TenantRecord {
  organization: OrganizationRef;
  profile: TenantProfile | null;
}

export interface TenantListRecord extends TenantRecord {
  memberCount: number;
}

export interface TenantDirectory {
  findBySubdomain(subdomain: string): Promise<TenantRecord | null>;
  findByCustomDomain(hostname: string): Promise<TenantRecord | null>;
  list(): Promise<TenantListRecord[]>;
}
