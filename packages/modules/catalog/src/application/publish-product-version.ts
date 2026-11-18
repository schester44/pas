import {
  canonicalJson,
  type Clock,
  type Outbox,
  type TenantContext,
  type UnitOfWork,
} from "@pas/kernel";
import { checkVersion, scheduledEditionIds } from "../domain/checks";
import { ProductRelease } from "../domain/product-release";
import type { FormEditionDirectory } from "../ports/form-edition-directory";
import type { ProductReleaseRepository } from "../ports/product-release-repository";
import type { ProductRepository } from "../ports/product-repository";
import type { ProductVersionRepository } from "../ports/product-version-repository";
import { publishedSiblings } from "./check-product-version";
import { type ProductReleaseDto, type ProductVersionDto, toReleaseDto, toVersionDto } from "./dto";
import { loadProduct, loadVersion } from "./load";

export function makePublishProductVersion(deps: {
  uow: UnitOfWork;
  outbox: Outbox;
  products: ProductRepository;
  versions: ProductVersionRepository;
  releases: ProductReleaseRepository;
  formEditions: FormEditionDirectory;
  clock: Clock;
}) {
  return async function publishProductVersion(
    ctx: TenantContext,
    input: { id: string },
  ): Promise<{ version: ProductVersionDto; releases: ProductReleaseDto[] }> {
    return deps.uow.run(ctx, async (tx) => {
      const version = await loadVersion(deps.versions, tx, ctx, input.id);
      const product = await loadProduct(deps.products, tx, ctx, version.toSnapshot().productId);
      const published = await publishedSiblings(deps.versions, tx, ctx, version);

      const editions = await deps.formEditions.existing(
        ctx,
        scheduledEditionIds(version.contents.documents),
      );

      const issues = checkVersion(version.contents, published, editions);

      const publishedAt = deps.clock.now();

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
        deps.clock,
      );

      product.activate(deps.clock);

      await deps.versions.save(tx, version);
      await deps.releases.insert(tx, releases);
      await deps.products.save(tx, product);
      await deps.outbox.add(tx, [...version.pullEvents(), ...product.pullEvents()]);

      return { version: toVersionDto(version), releases: releases.map(toReleaseDto) };
    });
  };
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type PublishProductVersion = ReturnType<typeof makePublishProductVersion>;
