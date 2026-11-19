import type { TenantContext } from "@pas/kernel";

/** Tenant members as Identity knows them, to link a producer to an existing login. */
export interface MemberDirectory {
  findByEmail(
    ctx: TenantContext,
    email: string,
  ): Promise<{ userId: string; name: string; role: string } | null>;
}
