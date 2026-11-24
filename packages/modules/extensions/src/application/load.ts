import { asId, notFound, type TenantContext, type Transaction } from "@pas/kernel";
import type { Extension } from "../domain/extension";
import type { ExtensionVersion } from "../domain/version";
import type { ExtensionRepository } from "../ports/repositories";

export async function loadExtension(
  repo: ExtensionRepository,
  tx: Transaction,
  ctx: TenantContext,
  id: string,
): Promise<Extension> {
  const extension = await repo.findById(tx, ctx, asId(id));

  if (!extension) throw notFound("Extension", id);

  return extension;
}

export async function loadVersion(
  repo: ExtensionRepository,
  tx: Transaction,
  ctx: TenantContext,
  id: string,
): Promise<ExtensionVersion> {
  const version = await repo.findVersion(tx, ctx, asId(id));

  if (!version) throw notFound("Extension version", id);

  return version;
}
