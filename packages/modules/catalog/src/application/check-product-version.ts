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
import { loadVersion } from "./load";

export interface ReferenceDeps {
  formEditions: FormEditionDirectory;
  rating: RatingVerifier;
  carriers?: CarrierVerifier;
  extensions?: ExtensionVerifier;
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

  const [formEditions, rating, carrier, extensions] = await Promise.all([
    deps.formEditions.existing(ctx, scheduledEditionIds(contents.documents)),
    deps.rating.verify(ctx, {
      rating: contents.rating,
      riskSchema: contents.riskSchema,
      coverageCodes: contents.coverages.map((coverage) => coverage.code),
    }),
    deps.carriers ? deps.carriers.verify(ctx, contents.lifecycle) : [],
    deps.extensions && references.length > 0 ? deps.extensions.verify(ctx, references) : [],
  ]);

  return { formEditions, rating, carrier, extensions };
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
