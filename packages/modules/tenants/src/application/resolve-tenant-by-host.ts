import type { AppHosts } from "../domain/hosts";
import { TenantProfile } from "../domain/tenant-profile";
import type { TenantDirectory, TenantRecord } from "../ports/tenant-directory";
import { type TenantBrandingDto, toTenantBrandingDto } from "./dto";

export interface ResolveTenantInput {
  host: string;
  slug?: string | null;
}

export type ResolvedTenant =
  | { status: "tenant"; tenantId: string; tenant: TenantBrandingDto }
  | { status: "platform" }
  | { status: "not_found" };

export function makeResolveTenantByHost(deps: { directory: TenantDirectory; hosts: AppHosts }) {
  return async function resolveTenantByHost(input: ResolveTenantInput): Promise<ResolvedTenant> {
    const match = deps.hosts.classify(input.host);
    let record: TenantRecord | null;

    switch (match.kind) {
      case "base": {
        const slug = input.slug?.trim().toLowerCase();

        if (!slug) return { status: "platform" };

        record = await deps.directory.findBySubdomain(slug);
        break;
      }
      case "subdomain":
        record = await deps.directory.findBySubdomain(match.subdomain);
        break;
      case "custom":
        record = await deps.directory.findByCustomDomain(match.hostname);
        break;
    }

    if (!record) return { status: "not_found" };

    const profile = record.profile ?? TenantProfile.initial(record.organization);

    return {
      status: "tenant",
      tenantId: record.organization.id,
      tenant: toTenantBrandingDto(profile, record.sandbox),
    };
  };
}

export type ResolveTenantByHost = ReturnType<typeof makeResolveTenantByHost>;
