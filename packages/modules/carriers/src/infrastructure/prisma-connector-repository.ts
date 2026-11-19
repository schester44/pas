import { instantFromDb, instantToDb, jsonToDb, prismaTx } from "@pas/db";
import type {
  CarrierConnectorVersion as VersionRow,
  CarrierFixture as FixtureRow,
} from "@pas/db/client";
import { asId, type TenantContext, type Transaction } from "@pas/kernel";
import type { ConnectorVersion } from "../domain/connector-version";
import type { Fixture } from "../domain/fixture";
import type { ConnectorRepository } from "../ports/repositories";

const toVersion = (row: VersionRow): ConnectorVersion => ({
  id: asId(row.id),
  tenantId: asId(row.tenantId),
  carrierId: asId(row.carrierId),
  version: row.version,
  status: row.status as ConnectorVersion["status"],
  definition: row.definition as unknown as ConnectorVersion["definition"],
  contentHash: row.contentHash,
  testReport: row.testReport as unknown as ConnectorVersion["testReport"],
  note: row.note,
  createdAt: instantFromDb(row.createdAt),
  updatedAt: instantFromDb(row.updatedAt),
  publishedAt: row.publishedAt ? instantFromDb(row.publishedAt) : null,
});

const toFixture = (row: FixtureRow): Fixture => ({
  id: row.id,
  carrierId: row.carrierId,
  capability: row.capability as Fixture["capability"],
  name: row.name,
  input: row.input as unknown as Fixture["input"],
  exchanges: row.exchanges as unknown as Fixture["exchanges"],
  callbacks: row.callbacks as unknown as Fixture["callbacks"],
  expected: row.expected as unknown as Fixture["expected"],
  createdAt: instantFromDb(row.createdAt),
});

export class PrismaConnectorRepository implements ConnectorRepository {
  async versions(tx: Transaction, ctx: TenantContext, carrierId: string) {
    const rows = await prismaTx(tx).carrierConnectorVersion.findMany({
      where: { tenantId: ctx.tenantId, carrierId },
      orderBy: { version: "desc" },
    });

    return rows.map(toVersion);
  }

  async findVersion(tx: Transaction, ctx: TenantContext, id: string) {
    const row = await prismaTx(tx).carrierConnectorVersion.findFirst({
      where: { tenantId: ctx.tenantId, id },
    });

    return row && toVersion(row);
  }

  async latestPublished(tx: Transaction, ctx: TenantContext, carrierId: string) {
    const row = await prismaTx(tx).carrierConnectorVersion.findFirst({
      where: { tenantId: ctx.tenantId, carrierId, status: "published" },
      orderBy: { version: "desc" },
    });

    return row && toVersion(row);
  }

  async saveVersion(tx: Transaction, version: ConnectorVersion) {
    const data = {
      status: version.status,
      definition: jsonToDb(version.definition),
      contentHash: version.contentHash,
      testReport: version.testReport ? jsonToDb(version.testReport) : undefined,
      note: version.note,
      updatedAt: instantToDb(version.updatedAt),
      publishedAt: version.publishedAt ? instantToDb(version.publishedAt) : null,
    };

    await prismaTx(tx).carrierConnectorVersion.upsert({
      where: { id: version.id },
      create: {
        id: version.id,
        tenantId: version.tenantId,
        carrierId: version.carrierId,
        version: version.version,
        createdAt: instantToDb(version.createdAt),
        ...data,
      },
      update: data,
    });
  }

  async fixtures(tx: Transaction, ctx: TenantContext, carrierId: string) {
    const rows = await prismaTx(tx).carrierFixture.findMany({
      where: { tenantId: ctx.tenantId, carrierId },
      orderBy: { createdAt: "asc" },
    });

    return rows.map(toFixture);
  }

  async saveFixture(tx: Transaction, ctx: TenantContext, fixture: Fixture) {
    await prismaTx(tx).carrierFixture.create({
      data: {
        id: fixture.id,
        tenantId: ctx.tenantId,
        carrierId: fixture.carrierId,
        capability: fixture.capability,
        name: fixture.name,
        input: jsonToDb(fixture.input),
        exchanges: jsonToDb(fixture.exchanges),
        callbacks: jsonToDb(fixture.callbacks),
        expected: jsonToDb(fixture.expected),
        createdAt: instantToDb(fixture.createdAt),
      },
    });
  }

  async deleteFixture(tx: Transaction, ctx: TenantContext, id: string) {
    await prismaTx(tx).carrierFixture.deleteMany({ where: { tenantId: ctx.tenantId, id } });
  }
}
