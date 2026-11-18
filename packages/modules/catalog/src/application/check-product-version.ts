import type { TenantContext, Transaction, UnitOfWork } from "@pas/kernel";
import {
  type CheckIssue,
  checkVersion,
  type PublishedAvailability,
  scheduledEditionIds,
} from "../domain/checks";
import type { ProductVersion } from "../domain/product-version";
import type { FormEditionDirectory } from "../ports/form-edition-directory";
import type { ProductVersionRepository } from "../ports/product-version-repository";
import { loadVersion } from "./load";

export function makeCheckProductVersion(deps: {
  uow: UnitOfWork;
  versions: ProductVersionRepository;
  formEditions: FormEditionDirectory;
}) {
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

    const editions = await deps.formEditions.existing(
      ctx,
      scheduledEditionIds(version.contents.documents),
    );

    return checkVersion(version.contents, published, editions);
  };
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
