import { newId, notFound, parsePlainDate, type TenantContext } from "@pas/kernel";
import {
  type AgencyCode,
  type Enrollment,
  normalizeAccountCode,
  normalizeAgencyCodes,
  normalizeMailbox,
} from "../domain/enrollment";
import type { AgencyDownloadsDeps } from "./deps";
import { type EnrollmentDto, toEnrollmentDto } from "./dto";

export interface SaveEnrollmentInput {
  agencyId: string;
  accountCode: string;
  mailbox: string | null;
  agencyCodes: AgencyCode[];
  enabled: boolean;
  startDate: string;
}

/** Distribution → Agencies → Downloads: which agencies get downloads, to which mailbox. */
export function makeManageEnrollments(deps: AgencyDownloadsDeps) {
  return {
    async list(ctx: TenantContext): Promise<EnrollmentDto[]> {
      const [enrollments, agencies] = await Promise.all([
        deps.uow.run(ctx, (tx) => deps.enrollments.list(tx, ctx)),
        deps.agencies.agencies(ctx),
      ]);

      const names = new Map(agencies.map((a) => [a.id, a.name]));

      return enrollments
        .map((e) => toEnrollmentDto(e, names.get(e.agencyId) ?? ""))
        .toSorted((a, b) => a.agencyName.localeCompare(b.agencyName));
    },

    async get(ctx: TenantContext, input: { agencyId: string }): Promise<EnrollmentDto | null> {
      const enrollment = await deps.uow.run(ctx, (tx) =>
        deps.enrollments.findByAgency(tx, ctx, input.agencyId),
      );

      if (!enrollment) return null;

      const agency = (await deps.agencies.agencies(ctx)).find((a) => a.id === input.agencyId);

      return toEnrollmentDto(enrollment, agency?.name ?? "");
    },

    async save(ctx: TenantContext, input: SaveEnrollmentInput): Promise<EnrollmentDto> {
      const agency = (await deps.agencies.agencies(ctx)).find((a) => a.id === input.agencyId);

      if (!agency) throw notFound("Agency", input.agencyId);

      const now = deps.clocks.forTenant(ctx.tenantId).now();

      const values = {
        accountCode: normalizeAccountCode(input.accountCode),
        mailbox: normalizeMailbox(input.mailbox),
        agencyCodes: normalizeAgencyCodes(input.agencyCodes),
        enabled: input.enabled,
        startDate: parsePlainDate(input.startDate),
      };

      const saved = await deps.uow.run(ctx, async (tx) => {
        const existing = await deps.enrollments.findByAgency(tx, ctx, input.agencyId);

        const enrollment: Enrollment = existing
          ? { ...existing, ...values, updatedAt: now }
          : {
              id: newId(),
              tenantId: ctx.tenantId,
              agencyId: input.agencyId,
              ...values,
              createdAt: now,
              updatedAt: now,
            };

        await deps.enrollments.save(tx, enrollment);

        return enrollment;
      });

      return toEnrollmentDto(saved, agency.name);
    },
  };
}

export type ManageEnrollments = ReturnType<typeof makeManageEnrollments>;
