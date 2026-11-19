import { instantFromDb, instantToDb, plainDateFromDb, plainDateToDb, prismaTx } from "@pas/db";
import type {
  AgencyMembership as MembershipRow,
  Appointment as AppointmentRow,
  Producer as ProducerRow,
  ProducerLicense as LicenseRow,
} from "@pas/db/client";
import { asId, newId, type TenantContext, type Transaction } from "@pas/kernel";
import type { License } from "../domain/license";
import type { Appointment, MembershipRole, Producer, ProducerStatus } from "../domain/producer";
import type { ProducerRepository } from "../ports/producer-repository";
import { optionalDate } from "./mappers";

const toProducer = (row: ProducerRow, memberships: readonly MembershipRow[]): Producer => ({
  id: asId(row.id),
  tenantId: asId(row.tenantId),
  userId: row.userId,
  name: row.name,
  email: row.email,
  producerNumber: row.producerNumber,
  npn: row.npn,
  status: row.status as ProducerStatus,
  memberships: memberships
    .filter((m) => m.producerId === row.id)
    .toSorted((a, b) => Number(b.primary) - Number(a.primary))
    .map((m) => ({
      agencyId: asId(m.agencyId),
      role: m.role as MembershipRole,
      primary: m.primary,
    })),
  createdAt: instantFromDb(row.createdAt),
  updatedAt: instantFromDb(row.updatedAt),
});

const toLicense = (row: LicenseRow): License => ({
  id: row.id,
  producerId: row.producerId,
  npn: row.npn,
  country: row.country,
  subdivision: row.subdivision,
  licenseNumber: row.licenseNumber,
  linesOfAuthority: row.linesOfAuthority,
  effectiveDate: plainDateFromDb(row.effectiveDate),
  expirationDate: optionalDate(row.expirationDate),
  status: row.status as License["status"],
  source: row.source as License["source"],
  verifiedAt: row.verifiedAt ? instantFromDb(row.verifiedAt) : null,
  updatedAt: instantFromDb(row.updatedAt),
});

const toAppointment = (row: AppointmentRow): Appointment => ({
  id: row.id,
  agencyId: row.agencyId ? asId(row.agencyId) : null,
  producerId: row.producerId ? asId(row.producerId) : null,
  carrier: row.carrier,
  country: row.country,
  subdivision: row.subdivision,
  status: row.status as Appointment["status"],
  effectiveDate: plainDateFromDb(row.effectiveDate),
  terminatedDate: optionalDate(row.terminatedDate),
  createdAt: instantFromDb(row.createdAt),
});

export class PrismaProducerRepository implements ProducerRepository {
  private async hydrate(tx: Transaction, ctx: TenantContext, rows: readonly ProducerRow[]) {
    const memberships = await prismaTx(tx).agencyMembership.findMany({
      where: { tenantId: ctx.tenantId, producerId: { in: rows.map((r) => r.id) } },
    });

    return rows.map((row) => toProducer(row, memberships));
  }

  async list(tx: Transaction, ctx: TenantContext, filter: { agencyIds?: readonly string[] }) {
    const rows = await prismaTx(tx).producer.findMany({
      where: {
        tenantId: ctx.tenantId,
        ...(filter.agencyIds && {
          id: {
            in: (
              await prismaTx(tx).agencyMembership.findMany({
                where: { tenantId: ctx.tenantId, agencyId: { in: [...filter.agencyIds] } },
                select: { producerId: true },
              })
            ).map((m) => m.producerId),
          },
        }),
      },
      orderBy: { name: "asc" },
    });

    return this.hydrate(tx, ctx, rows);
  }

  private async one(
    tx: Transaction,
    ctx: TenantContext,
    where: { id?: string; userId?: string; email?: string },
  ) {
    const row = await prismaTx(tx).producer.findFirst({
      where: { tenantId: ctx.tenantId, ...where },
    });

    return row ? (await this.hydrate(tx, ctx, [row]))[0]! : null;
  }

  findById(tx: Transaction, ctx: TenantContext, id: string) {
    return this.one(tx, ctx, { id });
  }

  findByUser(tx: Transaction, ctx: TenantContext, userId: string) {
    return this.one(tx, ctx, { userId });
  }

  findByEmail(tx: Transaction, ctx: TenantContext, email: string) {
    return this.one(tx, ctx, { email });
  }

  async save(tx: Transaction, ctx: TenantContext, producer: Producer): Promise<void> {
    const db = prismaTx(tx);

    const data = {
      userId: producer.userId,
      name: producer.name,
      email: producer.email,
      producerNumber: producer.producerNumber,
      npn: producer.npn,
      status: producer.status,
      updatedAt: instantToDb(producer.updatedAt),
    };

    await db.producer.upsert({
      where: { id: producer.id },
      update: data,
      create: {
        ...data,
        id: producer.id,
        tenantId: ctx.tenantId,
        createdAt: instantToDb(producer.createdAt),
      },
    });

    await db.agencyMembership.deleteMany({
      where: {
        tenantId: ctx.tenantId,
        producerId: producer.id,
        agencyId: { notIn: producer.memberships.map((m) => m.agencyId) },
      },
    });

    for (const m of producer.memberships) {
      await db.agencyMembership.upsert({
        where: {
          tenantId_agencyId_producerId: {
            tenantId: ctx.tenantId,
            agencyId: m.agencyId,
            producerId: producer.id,
          },
        },
        update: { role: m.role, primary: m.primary },
        create: {
          id: newId(),
          tenantId: ctx.tenantId,
          agencyId: m.agencyId,
          producerId: producer.id,
          role: m.role,
          primary: m.primary,
          createdAt: instantToDb(producer.updatedAt),
        },
      });
    }
  }

  async licenses(tx: Transaction, ctx: TenantContext, producerIds: readonly string[]) {
    const rows = await prismaTx(tx).producerLicense.findMany({
      where: { tenantId: ctx.tenantId, producerId: { in: [...producerIds] } },
      orderBy: [{ subdivision: "asc" }, { effectiveDate: "desc" }],
    });

    return rows.map(toLicense);
  }

  async saveLicense(tx: Transaction, ctx: TenantContext, license: License): Promise<void> {
    const now = instantToDb(license.updatedAt);

    const data = {
      npn: license.npn,
      country: license.country,
      subdivision: license.subdivision,
      licenseNumber: license.licenseNumber,
      linesOfAuthority: license.linesOfAuthority,
      effectiveDate: plainDateToDb(license.effectiveDate),
      expirationDate: license.expirationDate ? plainDateToDb(license.expirationDate) : null,
      status: license.status,
      source: license.source,
      verifiedAt: license.verifiedAt ? instantToDb(license.verifiedAt) : null,
      updatedAt: now,
    };

    const existing = await prismaTx(tx).producerLicense.findFirst({
      where: { tenantId: ctx.tenantId, id: license.id, producerId: license.producerId },
    });

    if (existing) {
      await prismaTx(tx).producerLicense.update({ where: { id: license.id }, data });

      return;
    }

    await prismaTx(tx).producerLicense.create({
      data: {
        ...data,
        id: license.id,
        tenantId: ctx.tenantId,
        producerId: license.producerId,
        createdAt: now,
      },
    });
  }

  async deleteLicense(
    tx: Transaction,
    ctx: TenantContext,
    key: { producerId: string; id: string },
  ) {
    await prismaTx(tx).producerLicense.deleteMany({
      where: { tenantId: ctx.tenantId, producerId: key.producerId, id: key.id },
    });
  }

  async appointments(
    tx: Transaction,
    ctx: TenantContext,
    filter: { agencyIds?: readonly string[]; producerIds?: readonly string[] },
  ) {
    const rows = await prismaTx(tx).appointment.findMany({
      where: {
        tenantId: ctx.tenantId,
        ...(filter.agencyIds && { agencyId: { in: [...filter.agencyIds] } }),
        ...(filter.producerIds && { producerId: { in: [...filter.producerIds] } }),
      },
      orderBy: [{ carrier: "asc" }, { subdivision: "asc" }],
    });

    return rows.map(toAppointment);
  }

  async saveAppointment(tx: Transaction, ctx: TenantContext, a: Appointment): Promise<void> {
    await prismaTx(tx).appointment.create({
      data: {
        id: a.id,
        tenantId: ctx.tenantId,
        agencyId: a.agencyId,
        producerId: a.producerId,
        carrier: a.carrier,
        country: a.country,
        subdivision: a.subdivision,
        status: a.status,
        effectiveDate: plainDateToDb(a.effectiveDate),
        terminatedDate: a.terminatedDate ? plainDateToDb(a.terminatedDate) : null,
        createdAt: instantToDb(a.createdAt),
      },
    });
  }
}
