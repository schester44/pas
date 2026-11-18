import { DomainError } from "@pas/kernel";
import { TenantProfile } from "../domain/tenant-profile";
import type { TenantDirectory } from "../ports/tenant-directory";
import type { TenantSummaryDto } from "./dto";

export interface PlatformActor {
  userId: string;
  role: string | null | undefined;
}

export function makeListTenants(deps: { directory: TenantDirectory }) {
  return async function listTenants(actor: PlatformActor): Promise<TenantSummaryDto[]> {
    if (actor.role !== "admin") {
      throw new DomainError("forbidden", "Only platform admins can list tenants");
    }

    const records = await deps.directory.list();

    return records.map(({ organization, profile, memberCount }) => {
      const p = (profile ?? TenantProfile.initial(organization)).toSnapshot();

      return {
        tenantId: organization.id,
        name: p.displayName,
        slug: organization.slug,
        appSubdomain: p.appSubdomain,
        customDomains: p.customDomains,
        primaryColor: p.primaryColor,
        memberCount,
        createdAt: organization.createdAt.toString(),
      };
    });
  };
}

export type ListTenants = ReturnType<typeof makeListTenants>;
