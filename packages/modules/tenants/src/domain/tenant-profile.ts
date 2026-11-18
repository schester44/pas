import {
  AggregateRoot,
  type Clock,
  type Id,
  type Instant,
  invalid,
  newId,
  type TenantId,
} from "@pas/kernel";
import { parseCustomDomain, parseSubdomain, subdomainFromSlug } from "./hosts";

export type TenantProfileId = Id<"TenantProfile">;

export const DEFAULT_PRIMARY_COLOR = "#656ae5";

const MAX_CUSTOM_DOMAINS = 10;
const HEX_COLOR = /^#[0-9a-f]{6}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9 ()\-.]{5,30}$/;

export interface OrganizationRef {
  id: TenantId;
  name: string;
  slug: string;
  createdAt: Instant;
}

export interface TenantProfileProps {
  id: TenantProfileId;
  tenantId: TenantId;
  displayName: string;
  primaryColor: string;
  logoUrl: string | null;
  appSubdomain: string;
  customDomains: string[];
  supportEmail: string | null;
  supportPhone: string | null;
  createdAt: Instant;
  updatedAt: Instant;
}

export interface TenantProfileChanges {
  displayName: string;
  primaryColor: string;
  logoUrl: string | null;
  appSubdomain: string;
  customDomains: string[];
  supportEmail: string | null;
  supportPhone: string | null;
}

export class TenantProfile extends AggregateRoot {
  private constructor(private props: TenantProfileProps) {
    super();
  }

  static initial(org: OrganizationRef): TenantProfile {
    return new TenantProfile({
      id: newId<"TenantProfile">(),
      tenantId: org.id,
      displayName: org.name,
      primaryColor: DEFAULT_PRIMARY_COLOR,
      logoUrl: null,
      appSubdomain: subdomainFromSlug(org.slug),
      customDomains: [],
      supportEmail: null,
      supportPhone: null,
      createdAt: org.createdAt,
      updatedAt: org.createdAt,
    });
  }

  static restore(props: TenantProfileProps): TenantProfile {
    return new TenantProfile(props);
  }

  update(changes: TenantProfileChanges, clock: Clock): void {
    const displayName = changes.displayName.trim();

    if (!displayName) throw invalid("Enter a display name", { field: "displayName" });

    if (displayName.length > 120) {
      throw invalid("Keep the display name under 120 characters", { field: "displayName" });
    }

    const primaryColor = changes.primaryColor.trim().toLowerCase();

    if (!HEX_COLOR.test(primaryColor)) {
      throw invalid("Use a hex colour like #0f766e", { field: "primaryColor" });
    }

    const logoUrl = optional(changes.logoUrl);

    if (logoUrl !== null && !isHttpUrl(logoUrl)) {
      throw invalid("Use a full https:// link to the logo image", { field: "logoUrl" });
    }

    const supportEmail = optional(changes.supportEmail);

    if (supportEmail !== null && !EMAIL.test(supportEmail)) {
      throw invalid("Enter a valid support email", { field: "supportEmail" });
    }

    const supportPhone = optional(changes.supportPhone);

    if (supportPhone !== null && !PHONE.test(supportPhone)) {
      throw invalid("Enter a valid support phone number", { field: "supportPhone" });
    }

    const customDomains = [...new Set(changes.customDomains.map(parseCustomDomain))];

    if (customDomains.length > MAX_CUSTOM_DOMAINS) {
      throw invalid(`Add at most ${MAX_CUSTOM_DOMAINS} custom domains`, { field: "customDomains" });
    }

    const now = clock.now();

    this.props = {
      ...this.props,
      displayName,
      primaryColor,
      logoUrl,
      appSubdomain: parseSubdomain(changes.appSubdomain),
      customDomains: customDomains.toSorted(),
      supportEmail,
      supportPhone,
      updatedAt: now,
    };

    this.record({
      id: newId(),
      type: "tenants.profile_updated",
      tenantId: this.props.tenantId,
      aggregateType: "tenant_profile",
      aggregateId: this.props.id,
      occurredAt: now,
      payload: {
        appSubdomain: this.props.appSubdomain,
        customDomains: this.props.customDomains,
      },
    });
  }

  get id(): TenantProfileId {
    return this.props.id;
  }

  toSnapshot(): Readonly<TenantProfileProps> {
    return { ...this.props, customDomains: [...this.props.customDomains] };
  }
}

function optional(value: string | null): string | null {
  const trimmed = value?.trim();

  return trimmed ? trimmed : null;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);

    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
