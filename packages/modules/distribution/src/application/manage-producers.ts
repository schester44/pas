import {
  asId,
  type BookScope,
  conflict,
  DomainError,
  invalid,
  newId,
  notFound,
  parsePlainDate,
  type TenantContext,
  type Transaction,
} from "@pas/kernel";
import type { License } from "../domain/license";
import type {
  AgencyMembership,
  MembershipRole,
  Producer,
  ProducerStatus,
} from "../domain/producer";
import type { MemberDirectory } from "../ports/member-directory";
import type { DistributionDeps } from "./deps";
import { type ProducerDetailDto, type ProducerDto, toAppointmentDto, toProducerDto } from "./dto";
import { assertCovers } from "./manage-agencies";

export interface InviteProducerInput {
  agencyId: string;
  name: string;
  email: string;
  role: MembershipRole;
  npn: string | null;
  producerNumber: string | null;
}

export interface SaveProducerInput {
  id: string;
  name: string;
  producerNumber: string | null;
  npn: string | null;
  status: ProducerStatus;
  memberships: { agencyId: string; role: MembershipRole; primary: boolean }[];
}

export interface SaveLicenseInput {
  id?: string;
  producerId: string;
  country: string;
  subdivision: string;
  licenseNumber: string;
  linesOfAuthority: string[];
  effectiveDate: string;
  expirationDate: string | null;
  status: License["status"];
}

export interface SaveAppointmentInput {
  agencyId: string | null;
  producerId: string | null;
  carrier: string;
  country: string;
  subdivision: string;
  effectiveDate: string;
}

type Deps = DistributionDeps & { members: MemberDirectory };

const normalizedEmail = (email: string) => email.trim().toLowerCase();

/** A producer in scope for the caller: in one of the caller's agencies, or any for staff. */
async function loadProducer(
  deps: Deps,
  tx: Transaction,
  ctx: TenantContext,
  scope: BookScope,
  id: string,
): Promise<Producer> {
  const producer = await deps.producers.findById(tx, ctx, id);

  if (!producer) throw notFound("Producer", id);

  if (
    scope.kind !== "tenant" &&
    !producer.memberships.some(
      (m) => scope.kind === "agencies" && scope.agencyIds.includes(m.agencyId),
    )
  ) {
    throw new DomainError("forbidden", "This producer isn't in your agency");
  }

  return producer;
}

async function detail(deps: Deps, tx: Transaction, ctx: TenantContext, producer: Producer) {
  const [agencies, licenses, appointments] = await Promise.all([
    deps.agencies.list(tx, ctx),
    deps.producers.licenses(tx, ctx, [producer.id]),
    deps.producers.appointments(tx, ctx, { producerIds: [producer.id] }),
  ]);

  const today = deps.clocks.forTenant(ctx.tenantId).today("UTC");

  return {
    ...toProducerDto(producer, { agencies, licenses, today }),
    appointments: appointments.map(toAppointmentDto),
  };
}

function normalizeMemberships(memberships: readonly AgencyMembership[]): AgencyMembership[] {
  if (memberships.length === 0) return [];

  const primary = memberships.find((m) => m.primary)?.agencyId ?? memberships[0]!.agencyId;

  return memberships.map((m) => ({ ...m, primary: m.agencyId === primary }));
}

/** Producers, their agency memberships, licenses and appointments. */
export function makeManageProducers(deps: Deps) {
  return {
    async get(
      ctx: TenantContext,
      scope: BookScope,
      input: { id: string },
    ): Promise<ProducerDetailDto> {
      return deps.uow.run(ctx, async (tx) =>
        detail(deps, tx, ctx, await loadProducer(deps, tx, ctx, scope, input.id)),
      );
    },

    /**
     * Adds a producer to an agency. An existing tenant member is linked at once; anyone else is
     * recorded as invited and linked when they accept the tenant invitation.
     */
    async invite(
      ctx: TenantContext,
      scope: BookScope,
      input: InviteProducerInput,
    ): Promise<{ producer: ProducerDto; needsInvitation: boolean }> {
      assertCovers(scope, input.agencyId);

      const email = normalizedEmail(input.email);
      const member = await deps.members.findByEmail(ctx, email);

      return deps.uow.run(ctx, async (tx) => {
        const agency = await deps.agencies.findById(tx, ctx, input.agencyId);

        if (!agency) throw notFound("Agency", input.agencyId);

        const now = deps.clocks.forTenant(ctx.tenantId).now();

        const existing =
          (await deps.producers.findByEmail(tx, ctx, email)) ??
          (member ? await deps.producers.findByUser(tx, ctx, member.userId) : null);

        if (existing?.memberships.some((m) => m.agencyId === agency.id)) {
          throw conflict(`${existing.name} is already a producer at ${agency.name}`);
        }

        const producer: Producer = existing
          ? {
              ...existing,
              memberships: normalizeMemberships([
                ...existing.memberships,
                { agencyId: agency.id, role: input.role, primary: false },
              ]),
              updatedAt: now,
            }
          : {
              id: asId(newId()),
              tenantId: ctx.tenantId,
              userId: member?.userId ?? null,
              name: input.name.trim() || member?.name || email,
              email,
              producerNumber: input.producerNumber?.trim() || null,
              npn: input.npn?.trim() || null,
              status: member ? "active" : "invited",
              memberships: [{ agencyId: agency.id, role: input.role, primary: true }],
              createdAt: now,
              updatedAt: now,
            };

        await deps.producers.save(tx, ctx, producer);

        const today = deps.clocks.forTenant(ctx.tenantId).today("UTC");
        const agencies = await deps.agencies.list(tx, ctx);

        return {
          producer: toProducerDto(producer, { agencies, licenses: [], today }),
          needsInvitation: !producer.userId,
        };
      });
    },

    /** Links the invited producer once their Better Auth invitation is accepted. */
    async linkUser(
      ctx: TenantContext,
      input: { userId: string; email: string; name: string },
    ): Promise<void> {
      await deps.uow.run(ctx, async (tx) => {
        const producer = await deps.producers.findByEmail(tx, ctx, normalizedEmail(input.email));

        if (!producer || producer.userId === input.userId) return;

        await deps.producers.save(tx, ctx, {
          ...producer,
          userId: input.userId,
          name: producer.name || input.name,
          status: producer.status === "invited" ? "active" : producer.status,
          updatedAt: deps.clocks.forTenant(ctx.tenantId).now(),
        });
      });
    },

    async save(
      ctx: TenantContext,
      scope: BookScope,
      input: SaveProducerInput,
    ): Promise<ProducerDetailDto> {
      for (const m of input.memberships) assertCovers(scope, m.agencyId);

      return deps.uow.run(ctx, async (tx) => {
        const producer = await loadProducer(deps, tx, ctx, scope, input.id);

        const kept = producer.memberships.filter(
          (m) => scope.kind === "agencies" && !scope.agencyIds.includes(m.agencyId),
        );

        const updated: Producer = {
          ...producer,
          name: input.name.trim(),
          producerNumber: input.producerNumber?.trim() || null,
          npn: input.npn?.trim() || null,
          status: producer.userId ? input.status : "invited",
          memberships: normalizeMemberships([
            ...kept,
            ...input.memberships.map((m) => ({ ...m, agencyId: asId<"Agency">(m.agencyId) })),
          ]),
          updatedAt: deps.clocks.forTenant(ctx.tenantId).now(),
        };

        await deps.producers.save(tx, ctx, updated);

        return detail(deps, tx, ctx, updated);
      });
    },

    async saveLicense(
      ctx: TenantContext,
      scope: BookScope,
      input: SaveLicenseInput,
    ): Promise<ProducerDetailDto> {
      return deps.uow.run(ctx, async (tx) => {
        const producer = await loadProducer(deps, tx, ctx, scope, input.producerId);

        if (!producer.npn) throw invalid(`Add ${producer.name}'s NPN before adding licenses`);

        const effectiveDate = parsePlainDate(input.effectiveDate);
        const expirationDate = input.expirationDate ? parsePlainDate(input.expirationDate) : null;

        if (expirationDate && Temporal.PlainDate.compare(expirationDate, effectiveDate) < 0) {
          throw invalid("The license expires before it's effective");
        }

        const now = deps.clocks.forTenant(ctx.tenantId).now();

        await deps.producers.saveLicense(tx, ctx, {
          id: input.id ?? newId(),
          producerId: producer.id,
          npn: producer.npn,
          country: input.country,
          subdivision: input.subdivision,
          licenseNumber: input.licenseNumber.trim(),
          linesOfAuthority: [
            ...new Set(input.linesOfAuthority.map((l) => l.trim()).filter(Boolean)),
          ],
          effectiveDate,
          expirationDate,
          status: input.status,
          source: "manual",
          verifiedAt: now,
          updatedAt: now,
        });

        return detail(deps, tx, ctx, producer);
      });
    },

    async removeLicense(
      ctx: TenantContext,
      scope: BookScope,
      input: { producerId: string; licenseId: string },
    ): Promise<ProducerDetailDto> {
      return deps.uow.run(ctx, async (tx) => {
        const producer = await loadProducer(deps, tx, ctx, scope, input.producerId);

        await deps.producers.deleteLicense(tx, ctx, {
          producerId: producer.id,
          id: input.licenseId,
        });

        return detail(deps, tx, ctx, producer);
      });
    },

    async saveAppointment(
      ctx: TenantContext,
      scope: BookScope,
      input: SaveAppointmentInput,
    ): Promise<void> {
      if (scope.kind !== "tenant")
        throw new DomainError("forbidden", "Only staff record appointments");

      if (!input.agencyId && !input.producerId) throw invalid("Choose an agency or a producer");

      await deps.uow.run(ctx, (tx) =>
        deps.producers.saveAppointment(tx, ctx, {
          id: newId(),
          agencyId: input.agencyId ? asId(input.agencyId) : null,
          producerId: input.producerId ? asId(input.producerId) : null,
          carrier: input.carrier.trim(),
          country: input.country,
          subdivision: input.subdivision,
          status: "active",
          effectiveDate: parsePlainDate(input.effectiveDate),
          terminatedDate: null,
          createdAt: deps.clocks.forTenant(ctx.tenantId).now(),
        }),
      );
    },
  };
}

export type ManageProducers = ReturnType<typeof makeManageProducers>;
