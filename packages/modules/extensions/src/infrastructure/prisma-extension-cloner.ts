import { jsonToDb as json, prismaTx } from "@pas/db";
import type { IdRemap, TenantContext, UnitOfWork } from "@pas/kernel";
import { type SealedSecret, secretContext } from "../domain/secret";
import type { SecretBox } from "../ports/services";

/**
 * Copies extensions into a sandbox (PLAN §15.4): drafts, published versions, secrets (sealed to
 * their tenant, so re-sealed) and automation subscriptions; never runs. Runs before the catalog
 * copy so product versions' bindings are rewritten to the copied version ids.
 */
export class PrismaExtensionCloner {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly secrets: SecretBox,
  ) {}

  async copy(from: TenantContext, to: TenantContext, ids: IdRemap) {
    const where = { tenantId: from.tenantId };

    const source = await this.uow.run(from, async (tx) => {
      const db = prismaTx(tx);

      return {
        extensions: await db.extension.findMany({ where }),
        versions: await db.extensionVersion.findMany({ where }),
        secrets: await db.extensionSecret.findMany({ where }),
        subscriptions: await db.extensionSubscription.findMany({ where }),
      };
    });

    for (const row of [...source.extensions, ...source.versions]) ids.id(row.id);

    const tenantId = to.tenantId;

    await this.uow.run(to, async (tx) => {
      const db = prismaTx(tx);

      await db.extension.createMany({
        data: source.extensions.map((e) => ({
          ...e,
          id: ids.id(e.id),
          tenantId,
          draft: json(e.draft),
        })),
      });

      await db.extensionVersion.createMany({
        data: source.versions.map((v) => ({
          ...v,
          id: ids.id(v.id),
          tenantId,
          extensionId: ids.id(v.extensionId),
          source: json(v.source),
          manifest: json(v.manifest),
          tests: json(v.tests),
          testReport: json(v.testReport),
        })),
      });

      await db.extensionSecret.createMany({
        data: source.secrets.map((s) => {
          const extensionId = ids.id(s.extensionId);

          const plain = this.secrets.open(
            s.sealed as unknown as SealedSecret,
            secretContext(from.tenantId, s.extensionId, s.name),
          );

          return {
            ...s,
            id: ids.id(s.id),
            tenantId,
            extensionId,
            sealed: json(this.secrets.seal(plain, secretContext(tenantId, extensionId, s.name))),
          };
        }),
      });

      await db.extensionSubscription.createMany({
        data: source.subscriptions.map((s) => ({
          ...s,
          id: ids.id(s.id),
          tenantId,
          extensionId: ids.id(s.extensionId),
          extensionVersionId: ids.id(s.extensionVersionId),
          eventTypes: json(s.eventTypes),
        })),
      });
    });

    return { extensions: source.extensions.length, versions: source.versions.length };
  }
}
