import {
  type ClockProvider,
  notFound,
  type Outbox,
  type TenantContext,
  type Transaction,
  type UnitOfWork,
} from "@pas/kernel";
import type { ObjectStorage } from "@pas/storage";
import { Inspection, type InspectionId } from "../domain/inspection";
import { type Person, Referral, type ReferralId } from "../domain/referral";
import { Subjectivity, type SubjectivityId } from "../domain/subjectivity";
import type { InspectionProviders } from "../ports/inspection-provider";
import type { QuoteDesk } from "../ports/quote-desk";
import type {
  InspectionRepository,
  ReferralRepository,
  SettingsRepository,
  SubjectivityRepository,
} from "../ports/repositories";
import type { UnderwritingTimeline } from "../ports/timeline";
import type { UnderwriterDirectory } from "../ports/underwriters";

export interface UnderwritingDeps {
  uow: UnitOfWork;
  outbox: Outbox;
  clocks: ClockProvider;
  referrals: ReferralRepository;
  subjectivities: SubjectivityRepository;
  inspections: InspectionRepository;
  settings: SettingsRepository;
  quotes: QuoteDesk;
  timeline: UnderwritingTimeline;
  inspectors: InspectionProviders;
  staff: UnderwriterDirectory;
  storage: ObjectStorage;
}

export const clockOf = (deps: Pick<UnderwritingDeps, "clocks">, ctx: TenantContext) =>
  deps.clocks.forTenant(ctx.tenantId);

/** The acting user, named as the session knows them. */
export const personOf = (ctx: TenantContext, name: string): Person => ({
  id: ctx.actor.type === "user" ? ctx.actor.userId : null,
  name,
});

export async function loadReferral(
  deps: Pick<UnderwritingDeps, "referrals">,
  tx: Transaction,
  ctx: TenantContext,
  id: string,
): Promise<Referral> {
  const referral = await deps.referrals.findById(tx, ctx, id as ReferralId);

  if (!referral) throw notFound("Referral", id);

  return referral;
}

export async function loadSubjectivity(
  deps: Pick<UnderwritingDeps, "subjectivities">,
  tx: Transaction,
  ctx: TenantContext,
  id: string,
): Promise<Subjectivity> {
  const subjectivity = await deps.subjectivities.findById(tx, ctx, id as SubjectivityId);

  if (!subjectivity) throw notFound("Subjectivity", id);

  return subjectivity;
}

export async function loadInspection(
  deps: Pick<UnderwritingDeps, "inspections">,
  tx: Transaction,
  ctx: TenantContext,
  id: string,
): Promise<Inspection> {
  const inspection = await deps.inspections.findById(tx, ctx, id as InspectionId);

  if (!inspection) throw notFound("Inspection", id);

  return inspection;
}

type Persistable = Referral | Subjectivity | Inspection;

export async function persist(
  deps: Pick<UnderwritingDeps, "referrals" | "subjectivities" | "inspections" | "outbox">,
  tx: Transaction,
  ...aggregates: Persistable[]
): Promise<void> {
  for (const aggregate of aggregates) {
    if (aggregate instanceof Referral) await deps.referrals.save(tx, aggregate);
    else if (aggregate instanceof Subjectivity) await deps.subjectivities.save(tx, aggregate);
    else if (aggregate instanceof Inspection) await deps.inspections.save(tx, aggregate);

    await deps.outbox.add(tx, aggregate.pullEvents());
  }
}
