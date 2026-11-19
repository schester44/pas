import type { TenantContext } from "@pas/kernel";

export interface StaffMember {
  userId: string;
  name: string;
  email: string;
  roles: string[];
}

/** The tenant's staff, for authority (held through roles) and assignment. */
export interface UnderwriterDirectory {
  member(ctx: TenantContext, userId: string): Promise<StaffMember | null>;
  list(ctx: TenantContext): Promise<StaffMember[]>;
}
