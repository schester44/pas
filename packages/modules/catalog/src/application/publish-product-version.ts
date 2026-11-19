import {
  canonicalJson,
  type ClockProvider,
  type Outbox,
  sha256,
  type TenantContext,
  type UnitOfWork,
} from "@pas/kernel";
import { checkVersion } from "../domain/checks";
import { ProductRelease } from "../domain/product-release";
import type { ProductReleaseRepository } from "../ports/product-release-repository";
import type { ProductRepository } from "../ports/product-repository";
import type { ProductVersionRepository } from "../ports/product-version-repository";
import { publishedSiblings, type ReferenceDeps, resolveReferences } from "./check-product-version";
import { type ProductReleaseDto, type ProductVersionDto, toReleaseDto, toVersionDto } from "./dto";
import { loadProduct, loadVersion } from "./load";

export function makePublishProductVersion(
  deps: {
    uow: UnitOfWork;
    outbox: Outbox;
    products: ProductRepository;
    versions: ProductVersionRepository;
    releases: ProductReleaseRepository;
    clocks: ClockProvider;
  } & ReferenceDeps,
) {
  return async function publishProductVersion(
    ctx: TenantContext,
    input: { id: string },
  ): Promise<{ version: ProductVersionDto; releases: ProductReleaseDto[] }> {
    return deps.uow.run(ctx, async (tx) => {
      const version = await loadVersion(deps.versions, tx, ctx, input.id);
      const product = await loadProduct(deps.products, tx, ctx, version.toSnapshot().productId);
      const published = await publishedSiblings(deps.versions, tx, ctx, version);

      const issues = checkVersion(
        version.contents,
        published,
        await resolveReferences(deps, ctx, version),
      );

      const publishedAt = deps.clocks.forTenant(ctx.tenantId).now();

      const releases = await Promise.all(
        version.contents.availability.map(async (window) => {
          const manifest = ProductRelease.manifestFor(version, window);
          const contentHash = await sha256(canonicalJson(manifest));

          return ProductRelease.create({ version, window, manifest, contentHash, publishedAt });
        }),
      );

      version.publish(
        issues,
        releases.map((release) => release.id),
        deps.clocks.forTenant(ctx.tenantId),
      );

      product.activate(deps.clocks.forTenant(ctx.tenantId));

      await deps.versions.save(tx, version);
      await deps.releases.insert(tx, releases);
      await deps.products.save(tx, product);
      await deps.outbox.add(tx, [...version.pullEvents(), ...product.pullEvents()]);

      return { version: toVersionDto(version), releases: releases.map(toReleaseDto) };
    });
  };
}

export type PublishProductVersion = ReturnType<typeof makePublishProductVersion>;
