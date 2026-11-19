import { prismaTx } from "@pas/db";
import type { Prisma } from "@pas/db/client";
import type { IdRemap, TenantContext, UnitOfWork } from "@pas/kernel";

/**
 * Copies the distribution network into a sandbox (PLAN §15.4): agencies with their agency-bill
 * terms, producers, memberships, licenses, appointments, commission schedules and licensing
 * requirements. Run after the catalog so product ids map to the sandbox's products.
 */
export class PrismaDistributionCloner {
  constructor(private readonly uow: UnitOfWork) {}

  async copy(from: TenantContext, to: TenantContext, ids: IdRemap) {
    const where = { tenantId: from.tenantId };

    const source = await this.uow.run(from, async (tx) => {
      const db = prismaTx(tx);

      return {
        agencies: await db.agency.findMany({ where, orderBy: { createdAt: "asc" } }),
        producers: await db.producer.findMany({ where }),
        memberships: await db.agencyMembership.findMany({ where }),
        licenses: await db.producerLicense.findMany({ where }),
        appointments: await db.appointment.findMany({ where }),
        schedules: await db.commissionSchedule.findMany({ where }),
        requirements: await db.licensingRequirement.findMany({ where }),
      };
    });

    const tenantId = to.tenantId;

    await this.uow.run(to, async (tx) => {
      const db = prismaTx(tx);

      await db.agency.createMany({
        data: source.agencies.map((a) => ({
          ...a,
          id: ids.id(a.id),
          tenantId,
          parentId: ids.maybe(a.parentId),
          address: (a.address ?? undefined) as Prisma.InputJsonValue | undefined,
        })),
      });

      await db.producer.createMany({
        data: source.producers.map((p) => ({ ...p, id: ids.id(p.id), tenantId })),
      });

      await db.agencyMembership.createMany({
        data: source.memberships.map((m) => ({
          ...m,
          id: ids.id(m.id),
          tenantId,
          agencyId: ids.id(m.agencyId),
          producerId: ids.id(m.producerId),
        })),
      });

      await db.producerLicense.createMany({
        data: source.licenses.map((l) => ({
          ...l,
          id: ids.id(l.id),
          tenantId,
          producerId: ids.id(l.producerId),
        })),
      });

      await db.appointment.createMany({
        data: source.appointments.map((a) => ({
          ...a,
          id: ids.id(a.id),
          tenantId,
          agencyId: ids.maybe(a.agencyId),
          producerId: ids.maybe(a.producerId),
        })),
      });

      await db.commissionSchedule.createMany({
        data: source.schedules.map((s) => ({
          ...s,
          id: ids.id(s.id),
          tenantId,
          productId: ids.maybe(s.productId),
        })),
      });

      await db.licensingRequirement.createMany({
        data: source.requirements.map((r) => ({
          ...r,
          id: ids.id(r.id),
          tenantId,
          productId: ids.id(r.productId),
        })),
      });
    });

    return {
      agencies: source.agencies.length,
      producers: source.producers.length,
      licenses: source.licenses.length,
    };
  }
}
