import type {
  GetProduct,
  GetProductRelease,
  ListOfferings,
  ListProducts,
  ResolvedReleaseDto,
  ResolveOffering,
  ResolveRelease,
} from "@pas/catalog";
import type { Jurisdiction, TenantContext } from "@pas/kernel";
import type { SelectionStrategy } from "../domain/quote-options";
import type { CatalogOffering, CatalogRelease, ProductCatalog } from "../ports/product-catalog";

/** Adapts the catalog's public use cases. Releases are immutable, so they're cached by id forever. */
export class CatalogProductCatalog implements ProductCatalog {
  private readonly releases = new Map<string, CatalogRelease>();

  constructor(
    private readonly catalog: {
      resolveRelease: ResolveRelease;
      getRelease: GetProductRelease;
      getProduct: GetProduct;
      listProducts: ListProducts;
      resolveOffering: ResolveOffering;
      listOfferings: ListOfferings;
    },
  ) {}

  async resolveOffering(
    ctx: TenantContext,
    input: { offeringId: string; jurisdiction: Jurisdiction; effectiveDate: string },
  ): Promise<CatalogOffering> {
    const offering = await this.catalog.resolveOffering(ctx, { ...input, kind: "new_business" });

    return {
      ...offering,
      selection: offering.selection as SelectionStrategy,
      releases: offering.releases.map((release) => this.remember(ctx, release)),
    };
  }

  async offeringNames(ctx: TenantContext): Promise<Map<string, string>> {
    const offerings = await this.catalog.listOfferings(ctx);

    return new Map(offerings.map((offering) => [offering.id, offering.name]));
  }

  async resolveNewBusiness(
    ctx: TenantContext,
    input: { productId: string; jurisdiction: Jurisdiction; effectiveDate: string },
  ): Promise<CatalogRelease | null> {
    const release = await this.catalog.resolveRelease(ctx, { ...input, kind: "new_business" });

    return release ? this.remember(ctx, release) : null;
  }

  async getRelease(ctx: TenantContext, id: string): Promise<CatalogRelease> {
    const cached = this.releases.get(cacheKey(ctx, id));

    if (cached) return cached;

    return this.remember(ctx, await this.catalog.getRelease(ctx, { id }));
  }

  async productName(ctx: TenantContext, productId: string): Promise<string> {
    return (await this.catalog.getProduct(ctx, { id: productId })).name;
  }

  async productNames(ctx: TenantContext): Promise<Map<string, string>> {
    const products = await this.catalog.listProducts(ctx);

    return new Map(products.map((product) => [product.id, product.name]));
  }

  private remember(ctx: TenantContext, dto: ResolvedReleaseDto): CatalogRelease {
    const release: CatalogRelease = {
      id: dto.id,
      productId: dto.productId,
      productVersionId: dto.productVersionId,
      version: dto.version,
      jurisdiction: dto.jurisdiction,
      riskSchema: dto.manifest.riskSchema,
      forms: dto.manifest.forms,
      market: dto.manifest.market ?? "admitted",
      coverages: dto.manifest.coverages,
      rules: dto.manifest.rules,
      rating: dto.manifest.rating,
      documents: dto.manifest.documents,
      lifecycle: dto.manifest.lifecycle,
      billing: dto.manifest.billing,
      extensions: dto.manifest.extensions ?? [],
      enrichment: dto.manifest.enrichment,
    };

    this.releases.set(cacheKey(ctx, dto.id), release);

    return release;
  }
}

const cacheKey = (ctx: TenantContext, id: string) => `${ctx.tenantId}:${id}`;
