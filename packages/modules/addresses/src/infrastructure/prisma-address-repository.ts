import type { AddressComponents, GeocodePrecision } from "@pas/addressing";
import { prismaTx } from "@pas/db";
import type { AddressRecord as Row, Prisma } from "@pas/db/client";
import { asId, type TenantContext, type Transaction } from "@pas/kernel";
import { AddressRecord } from "../domain/address-record";
import type { AddressRepository } from "../ports/address-repository";

const toInstant = (date: Date) => Temporal.Instant.fromEpochMilliseconds(date.getTime());
const toDate = (instant: Temporal.Instant) => new Date(instant.epochMilliseconds);

function toDomain(row: Row): AddressRecord {
  return AddressRecord.restore({
    id: asId(row.id),
    tenantId: asId(row.tenantId),
    key: row.key,
    textKey: row.textKey,
    provider: row.provider,
    providerAddressId: row.providerAddressId,
    status: row.status === "verified" ? "verified" : "unverified",
    address: {
      line1: row.line1,
      ...(row.line2 && { line2: row.line2 }),
      city: row.city,
      region: row.region,
      postalCode: row.postalCode,
      ...(row.plus4 && { plus4: row.plus4 }),
      country: row.country,
      components: row.components as AddressComponents,
      ...(row.countyName &&
        row.countyFips && { county: { name: row.countyName, fips: row.countyFips } }),
    },
    geocode:
      row.latitude !== null && row.longitude !== null
        ? {
            latitude: Number(row.latitude),
            longitude: Number(row.longitude),
            precision: (row.geocodePrecision ?? "unknown") as GeocodePrecision,
            source: row.geocodeSource ?? row.provider,
          }
        : null,
    dpv: {
      match: (row.dpvMatch as "Y" | "S" | "D" | "N" | null) ?? null,
      vacant: row.vacant,
      deliverable: row.deliverable,
    },
    verifiedAt: row.verifiedAt ? toInstant(row.verifiedAt) : null,
    createdAt: toInstant(row.createdAt),
    updatedAt: toInstant(row.updatedAt),
  });
}

function toRow(record: AddressRecord): Prisma.AddressRecordUncheckedCreateInput {
  const r = record.toSnapshot();

  return {
    id: r.id,
    tenantId: r.tenantId,
    key: r.key,
    textKey: r.textKey,
    provider: r.provider,
    providerAddressId: r.providerAddressId,
    status: r.status,
    line1: r.address.line1,
    line2: r.address.line2 ?? null,
    city: r.address.city,
    region: r.address.region,
    postalCode: r.address.postalCode,
    plus4: r.address.plus4 ?? null,
    country: r.address.country,
    components: r.address.components as Prisma.InputJsonObject,
    countyName: r.address.county?.name ?? null,
    countyFips: r.address.county?.fips ?? null,
    latitude: r.geocode?.latitude ?? null,
    longitude: r.geocode?.longitude ?? null,
    geocodePrecision: r.geocode?.precision ?? null,
    geocodeSource: r.geocode?.source ?? null,
    dpvMatch: r.dpv.match,
    vacant: r.dpv.vacant,
    deliverable: r.dpv.deliverable,
    verifiedAt: r.verifiedAt ? toDate(r.verifiedAt) : null,
    createdAt: toDate(r.createdAt),
    updatedAt: toDate(r.updatedAt),
  };
}

export class PrismaAddressRepository implements AddressRepository {
  async findById(tx: Transaction, ctx: TenantContext, id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;

    const row = await prismaTx(tx).addressRecord.findFirst({
      where: { tenantId: ctx.tenantId, id },
    });

    return row && toDomain(row);
  }

  async findByIds(tx: Transaction, ctx: TenantContext, ids: readonly string[]) {
    const valid = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));

    if (valid.length === 0) return [];

    const rows = await prismaTx(tx).addressRecord.findMany({
      where: { tenantId: ctx.tenantId, id: { in: valid } },
    });

    return rows.map(toDomain);
  }

  async findByKey(tx: Transaction, ctx: TenantContext, key: string) {
    const row = await prismaTx(tx).addressRecord.findUnique({
      where: { tenantId_key: { tenantId: ctx.tenantId, key } },
    });

    return row && toDomain(row);
  }

  async findByTextKeys(tx: Transaction, ctx: TenantContext, keys: readonly string[]) {
    const rows = await prismaTx(tx).addressRecord.findMany({
      where: { tenantId: ctx.tenantId, textKey: { in: [...keys] } },
      orderBy: { createdAt: "asc" },
    });

    return rows.map(toDomain);
  }

  async save(tx: Transaction, ctx: TenantContext, record: AddressRecord) {
    const db = prismaTx(tx);
    const { id, createdAt, tenantId, ...data } = toRow(record);
    const existing = await db.addressRecord.findFirst({ where: { tenantId: ctx.tenantId, id } });

    if (existing) {
      await db.addressRecord.update({ where: { id }, data });

      return record;
    }

    const created = await db.addressRecord.createMany({
      data: [{ id, createdAt, tenantId, ...data }],
      skipDuplicates: true,
    });

    if (created.count === 1) return record;

    return (await this.findByKey(tx, ctx, record.key)) ?? record;
  }
}
