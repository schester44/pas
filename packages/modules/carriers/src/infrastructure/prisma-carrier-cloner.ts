import { jsonToDb as json, prismaTx } from "@pas/db";
import type { IdRemap, TenantContext, UnitOfWork } from "@pas/kernel";
import { type SealedSecret, type SecretField, secretContext } from "../domain/connection";
import type { SecretBox } from "../ports/services";

/**
 * Copies carriers into a sandbox (PLAN §15.4): profiles, test connections (secrets are bound to
 * their tenant and connection, so they are re-sealed), connector versions, fixtures and feeds.
 * Product versions name carriers by key, so assignments keep working in the copy.
 */
export class PrismaCarrierCloner {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly secrets: SecretBox,
  ) {}

  private reseal(
    sealed: Record<string, SealedSecret>,
    from: { tenantId: string; id: string },
    to: { tenantId: string; id: string },
  ) {
    return Object.fromEntries(
      Object.entries(sealed).map(([field, value]) => {
        const plain = this.secrets.open(value, secretContext(from, field as SecretField));

        return [field, this.secrets.seal(plain, secretContext(to, field as SecretField))];
      }),
    );
  }

  async copy(from: TenantContext, to: TenantContext, ids: IdRemap) {
    const where = { tenantId: from.tenantId };

    const source = await this.uow.run(from, async (tx) => {
      const db = prismaTx(tx);

      return {
        carriers: await db.carrier.findMany({ where }),
        connections: await db.carrierConnection.findMany({
          where: { ...where, environment: "test" },
        }),
        versions: await db.carrierConnectorVersion.findMany({ where }),
        fixtures: await db.carrierFixture.findMany({ where }),
        feeds: await db.carrierFeed.findMany({ where }),
      };
    });

    const tenantId = to.tenantId;

    await this.uow.run(to, async (tx) => {
      const db = prismaTx(tx);

      await db.carrier.createMany({
        data: source.carriers.map((c) => ({
          ...c,
          id: ids.id(c.id),
          tenantId,
          activeEnvironment: "test",
          admitted: json(c.admitted),
          lines: json(c.lines),
        })),
      });

      await db.carrierConnection.createMany({
        data: source.connections.map((c) => ({
          ...c,
          id: ids.id(c.id),
          tenantId,
          carrierId: ids.id(c.carrierId),
          auth: json(c.auth),
          secrets: json(
            this.reseal(
              c.secrets as unknown as Record<string, SealedSecret>,
              { tenantId: from.tenantId, id: c.id },
              { tenantId, id: ids.id(c.id) },
            ),
          ),
          secretHints: json(c.secretHints),
          callback: json(c.callback),
        })),
      });

      await db.carrierConnectorVersion.createMany({
        data: source.versions.map((v) => ({
          ...v,
          id: ids.id(v.id),
          tenantId,
          carrierId: ids.id(v.carrierId),
          definition: json(v.definition),
          testReport: v.testReport === null ? undefined : json(v.testReport),
        })),
      });

      await db.carrierFixture.createMany({
        data: source.fixtures.map((f) => ({
          ...f,
          id: ids.id(f.id),
          tenantId,
          carrierId: ids.id(f.carrierId),
          input: json(f.input),
          exchanges: json(f.exchanges),
          callbacks: json(f.callbacks),
          expected: json(f.expected),
        })),
      });

      await db.carrierFeed.createMany({
        data: source.feeds.map((f) => ({
          ...f,
          id: ids.id(f.id),
          tenantId,
          carrierId: ids.id(f.carrierId),
          destination: json(f.destination),
          lastRunAt: null,
        })),
      });
    });

    return { carriers: source.carriers.length, connectors: source.versions.length };
  }
}
