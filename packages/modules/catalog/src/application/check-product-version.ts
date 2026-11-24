import type { TenantContext, Transaction, UnitOfWork } from "@pas/kernel";
import {
  type CheckIssue,
  checkVersion,
  type PublishedAvailability,
  type ResolvedReferences,
  scheduledEditionIds,
} from "../domain/checks";
import type { ProductVersion } from "../domain/product-version";
import type { FormEditionDirectory } from "../ports/form-edition-directory";
import type { ProductVersionRepository } from "../ports/product-version-repository";
import type { RatingVerifier } from "../ports/rating-verifier";
import type { CarrierVerifier } from "../ports/carrier-verifier";
import type { ExtensionVerifier } from "../ports/extension-verifier";
import type { EnrichmentDirectory } from "../ports/enrichment-directory";
import type { EnrichmentReferences } from "../domain/enrichment-checks";
import type { EnrichmentPlan } from "@pas/enrichment";
import { loadVersion } from "./load";

export interface ReferenceDeps {
  formEditions: FormEditionDirectory;
  rating: RatingVerifier;
  carriers?: CarrierVerifier;
  extensions?: ExtensionVerifier;
  enrichment?: EnrichmentDirectory;
}

export function makeCheckProductVersion(
  deps: { uow: UnitOfWork; versions: ProductVersionRepository } & ReferenceDeps,
) {
  return async function checkProductVersion(
    ctx: TenantContext,
    input: { id: string },
  ): Promise<CheckIssue[]> {
    const { version, published } = await deps.uow.run(ctx, async (tx) => {
      const loaded = await loadVersion(deps.versions, tx, ctx, input.id);

      return {
        version: loaded,
        published: await publishedSiblings(deps.versions, tx, ctx, loaded),
      };
    });

    return checkVersion(version.contents, published, await resolveReferences(deps, ctx, version));
  };
}

export async function resolveReferences(
  deps: ReferenceDeps,
  ctx: TenantContext,
  version: ProductVersion,
): Promise<ResolvedReferences> {
  const { contents } = version;

  const references = [
    ...contents.extensions.map((b) => ({
      bindingId: b.id,
      point: b.point,
      extensionVersionId: b.extensionVersionId,
    })),
    ...(contents.rating?.engine === "extension" && contents.rating.extensionVersionId
      ? [{ point: "rate" as const, extensionVersionId: contents.rating.extensionVersionId }]
      : []),
  ];

  const [formEditions, rating, carrier, extensionIssues, enrichment] = await Promise.all([
    deps.formEditions.existing(ctx, scheduledEditionIds(contents.documents)),
    deps.rating.verify(ctx, {
      rating: contents.rating,
      riskSchema: contents.riskSchema,
      coverageCodes: contents.coverages.map((coverage) => coverage.code),
    }),
    deps.carriers ? deps.carriers.verify(ctx, contents.lifecycle) : [],
    deps.extensions && references.length > 0 ? deps.extensions.verify(ctx, references) : [],
    deps.enrichment ? enrichmentReferences(deps.enrichment, ctx, contents.enrichment) : undefined,
  ]);

  return {
    formEditions,
    rating,
    carrier,
    extensions: extensionIssues,
    ...(enrichment && { enrichment }),
  };
}

export async function enrichmentReferences(
  directory: EnrichmentDirectory,
  ctx: TenantContext,
  plan: EnrichmentPlan,
): Promise<EnrichmentReferences> {
  const keys = [...new Set(plan.transforms.map((t) => t.extension.key))];

  const [providers, extensions] = await Promise.all([
    directory.providers(ctx),
    Promise.all(keys.map(async (key) => [key, await directory.extension(ctx, key)] as const)),
  ]);

  return { providers, extensions: new Map(extensions) };
}

export async function publishedSiblings(
  versions: ProductVersionRepository,
  tx: Transaction,
  ctx: TenantContext,
  version: ProductVersion,
): Promise<PublishedAvailability[]> {
  const siblings = await versions.listByProduct(tx, ctx, version.toSnapshot().productId);

  return siblings
    .filter((other) => other.id !== version.id && other.status === "published")
    .map((other) => ({
      version: other.toSnapshot().version,
      availability: other.contents.availability,
    }));
}

export type CheckProductVersion = ReturnType<typeof makeCheckProductVersion>;
