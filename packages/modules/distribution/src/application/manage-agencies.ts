import {
  asId,
  type BookScope,
  DomainError,
  Money,
  newId,
  notFound,
  type TenantContext,
  type Transaction,
} from "@pas/kernel";
import {
  type Agency,
  type AgencyAddress,
  type AgencyStatus,
  assertParent,
  type CommissionBasis,
  type RemittanceBasis,
} from "../domain/agency";
import { coversAgency } from "../domain/book-scope";
import type { DistributionDeps } from "./deps";
import {
  type AgencyDetailDto,
  type AgencyDto,
  toAgencyDto,
  toAppointmentDto,
  toProducerDto,
} from "./dto";

export interface SaveAgencyInput {
  id?: string;
  parentId: string | null;
  name: string;
  legalName: string | null;
  fein: string | null;
  address: AgencyAddress | null;
  phone: string | null;
  email: string | null;
  status: AgencyStatus;
  tier: string;
  billing: {
    eligible: boolean;
    remittanceDays: number | null;
    creditLimit: string | null;
    remittanceBasis: RemittanceBasis;
    commissionBasis: CommissionBasis | null;
    statementDay: number | null;
    reminderDays: number | null;
    suspendAfterDays: number | null;
    nonpaymentCancels: boolean;
  };
}

const forbidden = () => new DomainError("forbidden", "You can't manage this agency");

export function assertCovers(scope: BookScope, agencyId: string) {
  if (!coversAgency(scope, agencyId)) throw forbidden();
}

const visible = (scope: BookScope, agencies: readonly Agency[]) =>
  agencies.filter((a) => coversAgency(scope, a.id));

async function loadAll(deps: DistributionDeps, tx: Transaction, ctx: TenantContext) {
  const [agencies, producers] = await Promise.all([
    deps.agencies.list(tx, ctx),
    deps.producers.list(tx, ctx, {}),
  ]);

  const licenses = await deps.producers.licenses(
    tx,
    ctx,
    producers.map((p) => p.id),
  );

  const today = deps.clocks.forTenant(ctx.tenantId).today("UTC");

  return { agencies, producers, licenses, today };
}

/** Agencies, their hierarchy and producers (PLAN §4 Distribution). */
export function makeManageAgencies(deps: DistributionDeps) {
  return {
    async list(ctx: TenantContext, scope: BookScope): Promise<AgencyDto[]> {
      return deps.uow.run(ctx, async (tx) => {
        const all = await loadAll(deps, tx, ctx);

        return visible(scope, all.agencies)
          .toSorted((a, b) => a.name.localeCompare(b.name))
          .map((a) => toAgencyDto(a, all));
      });
    },

    async get(
      ctx: TenantContext,
      scope: BookScope,
      input: { id: string },
    ): Promise<AgencyDetailDto> {
      assertCovers(scope, input.id);

      return deps.uow.run(ctx, async (tx) => {
        const all = await loadAll(deps, tx, ctx);
        const agency = all.agencies.find((a) => a.id === input.id);

        if (!agency) throw notFound("Agency", input.id);

        const parent = all.agencies.find((a) => a.id === agency.parentId) ?? null;

        const producers = all.producers.filter((p) =>
          p.memberships.some((m) => m.agencyId === agency.id),
        );

        const appointments = await deps.producers.appointments(tx, ctx, { agencyIds: [agency.id] });

        return {
          ...toAgencyDto(agency, all),
          parent: parent && { id: parent.id, name: parent.name },
          children: all.agencies
            .filter((a) => a.parentId === agency.id)
            .map((a) => ({
              id: a.id,
              name: a.name,
              status: a.status,
              producerCount: toAgencyDto(a, all).producerCount,
            })),
          producers: producers
            .toSorted((a, b) => a.name.localeCompare(b.name))
            .map((p) => toProducerDto(p, all)),
          appointments: appointments.map(toAppointmentDto),
        };
      });
    },

    async save(ctx: TenantContext, scope: BookScope, input: SaveAgencyInput): Promise<AgencyDto> {
      if (input.id) assertCovers(scope, input.id);
      else if (scope.kind !== "tenant") throw forbidden();

      return deps.uow.run(ctx, async (tx) => {
        const all = await loadAll(deps, tx, ctx);
        const existing = input.id ? all.agencies.find((a) => a.id === input.id) : undefined;

        if (input.id && !existing) throw notFound("Agency", input.id);

        const id = asId<"Agency">(input.id ?? newId());
        const parentId = input.parentId ? asId<"Agency">(input.parentId) : null;

        if (existing && scope.kind !== "tenant" && parentId !== existing.parentId)
          throw forbidden();

        assertParent(all.agencies, id, parentId);

        const now = deps.clocks.forTenant(ctx.tenantId).now();
        const currency = existing?.billing.creditLimit?.currency ?? "USD";

        const agency: Agency = {
          id,
          tenantId: ctx.tenantId,
          parentId,
          name: input.name.trim(),
          legalName: input.legalName?.trim() || null,
          fein: input.fein?.trim() || null,
          address: input.address,
          phone: input.phone?.trim() || null,
          email: input.email?.trim() || null,
          status: input.status,
          tier: input.tier.trim() || "standard",
          billing: {
            eligible: input.billing.eligible,
            remittanceDays: input.billing.remittanceDays,
            creditLimit: input.billing.creditLimit
              ? Money.of(input.billing.creditLimit, currency)
              : null,
            remittanceBasis: input.billing.remittanceBasis,
            commissionBasis: input.billing.commissionBasis,
            statementDay: input.billing.statementDay,
            reminderDays: input.billing.reminderDays,
            suspendAfterDays: input.billing.suspendAfterDays,
            nonpaymentCancels: input.billing.nonpaymentCancels,
            suspension: input.billing.eligible ? (existing?.billing.suspension ?? null) : null,
          },
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };

        await deps.agencies.save(tx, agency);

        return toAgencyDto(agency, {
          ...all,
          agencies: [...all.agencies.filter((a) => a.id !== id), agency],
        });
      });
    },
  };
}

export type ManageAgencies = ReturnType<typeof makeManageAgencies>;
