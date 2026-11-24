import { type DocumentSet, emptyDocumentSet } from "@pas/documents";
import type { ExtensionBinding } from "@pas/extension-points";
import { type EnrichmentPlan, enrichmentPlanOf } from "@pas/enrichment";
import type { FormDefinition, RiskSchema } from "@pas/forms-core";
import { type BillingConfig, billingConfigOf } from "@pas/pay-plans";
import {
  type Id,
  type Instant,
  type Jurisdiction,
  newId,
  type PlainDate,
  sameJurisdiction,
  type TenantId,
} from "@pas/kernel";
import type { RatingConfig } from "@pas/rating-engine";
import {
  type AvailabilityKind,
  type AvailabilityWindow,
  type DateWindow,
  type Market,
  type DateWindowJson,
  dateWindowToJson,
  windowContains,
  windowFor,
} from "./availability";
import type { CoverageDefinition } from "./coverage";
import type { ProductId } from "./product";
import type { ProductVersion, ProductVersionId } from "./product-version";
import type { FormChannel, FormStage, VersionDecision } from "./version-contents";

export type ProductReleaseId = Id<"ProductRelease">;

export interface ReleaseManifest {
  productId: string;
  productVersionId: string;
  version: string;
  jurisdiction: Jurisdiction;
  market: Market;
  newBusiness: DateWindowJson;
  renewal: DateWindowJson;
  riskSchema: RiskSchema;
  forms: { channel: FormChannel; stage: FormStage; form: FormDefinition }[];
  coverages: CoverageDefinition[];
  lifecycle: Record<string, unknown>;
  documents: DocumentSet;
  rules: VersionDecision[];
  rating: RatingConfig | null;
  billing: BillingConfig;
  extensions: ExtensionBinding[];
  enrichment: EnrichmentPlan;
}

export function completeManifest(
  stored: Partial<ReleaseManifest> &
    Pick<
      ReleaseManifest,
      | "productId"
      | "productVersionId"
      | "version"
      | "jurisdiction"
      | "newBusiness"
      | "renewal"
      | "riskSchema"
    >,
): ReleaseManifest {
  return {
    ...stored,
    market: stored.market ?? "admitted",
    forms: stored.forms ?? [],
    coverages: stored.coverages ?? [],
    lifecycle: stored.lifecycle ?? {},
    documents: { ...emptyDocumentSet(), ...stored.documents },
    rules: stored.rules ?? [],
    rating: stored.rating ?? null,
    billing: billingConfigOf(stored.billing),
    extensions: stored.extensions ?? [],
    enrichment: enrichmentPlanOf(stored.enrichment),
  };
}

export interface ProductReleaseProps {
  id: ProductReleaseId;
  tenantId: TenantId;
  productId: ProductId;
  productVersionId: ProductVersionId;
  version: string;
  jurisdiction: Jurisdiction;
  newBusiness: DateWindow;
  renewal: DateWindow;
  manifest: ReleaseManifest;
  contentHash: string;
  publishedAt: Instant;
}

/** The immutable, resolved manifest of one product version for one jurisdiction (PLAN §6.1). */
export class ProductRelease {
  private constructor(private readonly props: ProductReleaseProps) {}

  static manifestFor(version: ProductVersion, window: AvailabilityWindow): ReleaseManifest {
    const v = version.toSnapshot();

    return {
      productId: v.productId,
      productVersionId: v.id,
      version: v.version,
      jurisdiction: window.jurisdiction,
      market: window.market ?? "admitted",
      newBusiness: dateWindowToJson(window.newBusiness),
      renewal: dateWindowToJson(window.renewal),
      riskSchema: v.contents.riskSchema,
      forms: v.contents.forms,
      coverages: v.contents.coverages,
      lifecycle: v.contents.lifecycle,
      documents: v.contents.documents,
      rules: v.contents.rules,
      rating: v.contents.rating,
      billing: v.contents.billing,
      extensions: v.contents.extensions,
      enrichment: v.contents.enrichment,
    };
  }

  static create(input: {
    version: ProductVersion;
    window: AvailabilityWindow;
    manifest: ReleaseManifest;
    contentHash: string;
    publishedAt: Instant;
  }): ProductRelease {
    const v = input.version.toSnapshot();

    return new ProductRelease({
      id: newId<"ProductRelease">(),
      tenantId: v.tenantId,
      productId: v.productId,
      productVersionId: v.id,
      version: v.version,
      jurisdiction: input.window.jurisdiction,
      newBusiness: input.window.newBusiness,
      renewal: input.window.renewal,
      manifest: input.manifest,
      contentHash: input.contentHash,
      publishedAt: input.publishedAt,
    });
  }

  static restore(props: ProductReleaseProps): ProductRelease {
    return new ProductRelease(props);
  }

  get id(): ProductReleaseId {
    return this.props.id;
  }

  windowFor(kind: AvailabilityKind): DateWindow {
    return windowFor(this.props, kind);
  }

  toSnapshot(): Readonly<ProductReleaseProps> {
    return this.props;
  }
}

/** The release for `jurisdiction` whose window contains `date`; the latest-starting window wins. */
export function selectRelease(
  candidates: readonly ProductRelease[],
  jurisdiction: Jurisdiction,
  date: PlainDate,
  kind: AvailabilityKind,
): ProductRelease | null {
  let best: ProductRelease | null = null;

  for (const release of candidates) {
    if (!sameJurisdiction(release.toSnapshot().jurisdiction, jurisdiction)) continue;

    const window = release.windowFor(kind);

    if (!windowContains(window, date)) continue;

    if (!best || Temporal.PlainDate.compare(window.from, best.windowFor(kind).from) > 0) {
      best = release;
    }
  }

  return best;
}
