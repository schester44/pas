import { instantFromDb, instantToDb, jsonToDb, type PrismaClient, prismaTx } from "@pas/db";
import type { Carrier as CarrierRow, CarrierConnection as ConnectionRow } from "@pas/db/client";
import { asId, type TenantContext, type Transaction } from "@pas/kernel";
import type { Carrier } from "../domain/carrier";
import type { CarrierConnection } from "../domain/connection";
import type { CarrierRepository, ConnectionLocator } from "../ports/repositories";

const toCarrier = (row: CarrierRow): Carrier => ({
  id: asId(row.id),
  tenantId: asId(row.tenantId),
  key: row.key,
  name: row.name,
  naic: row.naic,
  amBest: row.amBest,
  admitted: row.admitted as string[],
  lines: row.lines as string[],
  mode: row.mode as Carrier["mode"],
  extensionKey: row.extensionKey,
  activeEnvironment: row.activeEnvironment as Carrier["activeEnvironment"],
  status: row.status as Carrier["status"],
  createdAt: instantFromDb(row.createdAt),
  updatedAt: instantFromDb(row.updatedAt),
});

const toConnection = (row: ConnectionRow): CarrierConnection => ({
  id: asId(row.id),
  tenantId: asId(row.tenantId),
  carrierId: asId(row.carrierId),
  environment: row.environment as CarrierConnection["environment"],
  baseUrl: row.baseUrl,
  auth: row.auth as unknown as CarrierConnection["auth"],
  secrets: row.secrets as unknown as CarrierConnection["secrets"],
  secretHints: row.secretHints as CarrierConnection["secretHints"],
  callback: row.callback as unknown as CarrierConnection["callback"],
  createdAt: instantFromDb(row.createdAt),
  updatedAt: instantFromDb(row.updatedAt),
});

export class PrismaCarrierRepository implements CarrierRepository {
  async list(tx: Transaction, ctx: TenantContext) {
    const rows = await prismaTx(tx).carrier.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { name: "asc" },
    });

    return rows.map(toCarrier);
  }

  async findById(tx: Transaction, ctx: TenantContext, id: string) {
    const row = await prismaTx(tx).carrier.findFirst({ where: { tenantId: ctx.tenantId, id } });

    return row && toCarrier(row);
  }

  async findByKey(tx: Transaction, ctx: TenantContext, key: string) {
    const row = await prismaTx(tx).carrier.findFirst({ where: { tenantId: ctx.tenantId, key } });

    return row && toCarrier(row);
  }

  async save(tx: Transaction, carrier: Carrier) {
    const data = {
      key: carrier.key,
      name: carrier.name,
      naic: carrier.naic,
      amBest: carrier.amBest,
      admitted: carrier.admitted,
      lines: carrier.lines,
      mode: carrier.mode,
      extensionKey: carrier.extensionKey,
      activeEnvironment: carrier.activeEnvironment,
      status: carrier.status,
      updatedAt: instantToDb(carrier.updatedAt),
    };

    await prismaTx(tx).carrier.upsert({
      where: { id: carrier.id },
      create: {
        id: carrier.id,
        tenantId: carrier.tenantId,
        createdAt: instantToDb(carrier.createdAt),
        ...data,
      },
      update: data,
    });
  }

  async connections(tx: Transaction, ctx: TenantContext, carrierId: string) {
    const rows = await prismaTx(tx).carrierConnection.findMany({
      where: { tenantId: ctx.tenantId, carrierId },
      orderBy: { environment: "desc" },
    });

    return rows.map(toConnection);
  }

  async findConnection(tx: Transaction, ctx: TenantContext, id: string) {
    const row = await prismaTx(tx).carrierConnection.findFirst({
      where: { tenantId: ctx.tenantId, id },
    });

    return row && toConnection(row);
  }

  async saveConnection(tx: Transaction, connection: CarrierConnection) {
    const data = {
      baseUrl: connection.baseUrl,
      auth: jsonToDb(connection.auth),
      secrets: jsonToDb(connection.secrets),
      secretHints: jsonToDb(connection.secretHints),
      callback: jsonToDb(connection.callback),
      updatedAt: instantToDb(connection.updatedAt),
    };

    await prismaTx(tx).carrierConnection.upsert({
      where: { id: connection.id },
      create: {
        id: connection.id,
        tenantId: connection.tenantId,
        carrierId: connection.carrierId,
        environment: connection.environment,
        createdAt: instantToDb(connection.createdAt),
        ...data,
      },
      update: data,
    });
  }
}

/** Platform-level lookup for inbound callbacks, which only name their connection. */
export class PrismaConnectionLocator implements ConnectionLocator {
  constructor(private readonly prisma: PrismaClient) {}

  async tenantOf(connectionId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(connectionId)) return null;

    const row = await this.prisma.carrierConnection.findUnique({
      where: { id: connectionId },
      select: { tenantId: true },
    });

    return row?.tenantId ?? null;
  }
}
