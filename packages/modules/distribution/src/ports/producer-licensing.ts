import type { ProviderFor, TenantContext } from "@pas/kernel";

/** A license as the licensing source reports it (manual records, NIPR, a fake). */
export interface LicenseRecord {
  npn: string;
  country: string;
  subdivision: string;
  licenseNumber: string;
  linesOfAuthority: string[];
  effectiveDate: string;
  expirationDate: string | null;
  status: "active" | "inactive";
}

/** Where licenses come from at quote and bind (PLAN §11): the tenant's licensing integration. */
export interface ProducerLicenseLookup {
  readonly provider: string;
  licenses(
    ctx: TenantContext,
    producer: { producerId: string; npn: string | null },
  ): Promise<LicenseRecord[]>;
}

export type ProducerLicensing = ProviderFor<ProducerLicenseLookup>;
