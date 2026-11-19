import { newId } from "@pas/kernel";
import { migration } from "../types";

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/**
 * Policies and submissions written before agencies existed get a producer of record and an
 * agency of record. Each producer joins the agency named in their latest bind details, else the
 * tenant's house agency (named after the tenant).
 */
export default migration({
  name: "20261119-01-distribution-agencies",
  async up({ db }) {
    const now = new Date();
    const submissions = await db.submission.findMany({ orderBy: { createdAt: "asc" } });
    const tenants = [...new Set(submissions.map((s) => s.tenantId))];

    for (const tenantId of tenants) {
      const organization = await db.organization.findUnique({ where: { id: tenantId } });
      const own = submissions.filter((s) => s.tenantId === tenantId);

      const quotes = await db.quote.findMany({
        where: { tenantId },
        orderBy: { updatedAt: "asc" },
      });

      const named = new Map<string, string>();

      for (const quote of quotes) {
        const submission = own.find((s) => s.id === quote.submissionId);
        const details = quote.details as { producer?: { agency?: unknown } } | null;
        const agency = text(details?.producer?.agency);

        if (submission && agency) named.set(submission.producerId, agency);
      }

      const agencyIds = new Map<string, string>();

      const agencyFor = async (name: string) => {
        const known =
          agencyIds.get(name) ?? (await db.agency.findFirst({ where: { tenantId, name } }))?.id;

        if (known) return agencyIds.set(name, known).get(name)!;

        const id = newId();

        await db.agency.create({
          data: {
            id,
            tenantId,
            name,
            status: "active",
            tier: "standard",
            createdAt: now,
            updatedAt: now,
          },
        });

        return agencyIds.set(name, id).get(name)!;
      };

      const producers = new Map(own.map((s) => [s.producerId, s.producerName]));

      for (const [userId, producerName] of producers) {
        const agencyName = named.get(userId) ?? organization?.name ?? "House";
        const agencyId = await agencyFor(agencyName);
        const user = await db.user.findUnique({ where: { id: userId } });
        let producer = await db.producer.findFirst({ where: { tenantId, userId } });

        if (!producer) {
          producer = await db.producer.create({
            data: {
              id: newId(),
              tenantId,
              userId,
              name: user?.name ?? producerName,
              email: (user?.email ?? `${userId}@unknown.invalid`).toLowerCase(),
              status: "active",
              createdAt: now,
              updatedAt: now,
            },
          });
        }

        const memberships = await db.agencyMembership.count({
          where: { tenantId, producerId: producer.id },
        });

        if (memberships === 0) {
          await db.agencyMembership.create({
            data: {
              id: newId(),
              tenantId,
              agencyId,
              producerId: producer.id,
              role: "producer",
              primary: true,
              createdAt: now,
            },
          });
        }

        const primary = await db.agencyMembership.findFirst({
          where: { tenantId, producerId: producer.id },
          orderBy: { primary: "desc" },
        });

        const agency = await db.agency.findUnique({ where: { id: primary!.agencyId } });

        await db.policy.updateMany({
          where: { tenantId, producerId: userId, agencyId: null },
          data: { agencyId: agency!.id, agencyName: agency!.name },
        });

        await db.submission.updateMany({
          where: { tenantId, producerId: userId, agencyId: null },
          data: { agencyId: agency!.id },
        });
      }
    }
  },
});
