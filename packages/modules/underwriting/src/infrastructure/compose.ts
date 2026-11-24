import type { PrismaClient } from "@pas/db";
import type { ClockProvider, Outbox, UnitOfWork } from "@pas/kernel";
import type { ObjectStorage } from "@pas/storage";
import { makeApproveReferral } from "../application/approve-referral";
import { makeAssignReferral } from "../application/assign-referral";
import { makeNoteReferral, makeReplyToReferral, makeRequestInfo } from "../application/converse";
import { makeClosePolicyConditions } from "../application/close-policy-conditions";
import { makeDeclineReferral } from "../application/decline-referral";
import type { UnderwritingDeps } from "../application/deps";
import { makeGetReferral } from "../application/get-referral";
import { makeInspectionTimers } from "../application/inspection-timers";
import { makeListInspections } from "../application/list-inspections";
import { makeListProducerActions } from "../application/list-producer-actions";
import { makeListReferrals } from "../application/list-referrals";
import { makeManageSettings } from "../application/manage-settings";
import { makeManageSubjectivities } from "../application/manage-subjectivities";
import { makeCloseReferrals, makeOpenReferral } from "../application/open-referral";
import { makeReviewInspection } from "../application/review-inspection";
import { makeSubjectivityTimers } from "../application/subjectivity-timers";
import {
  makeOutstandingConditions,
  makeSyncQuoteConditions,
} from "../application/sync-quote-conditions";
import type { InspectionProviders } from "../ports/inspection-provider";
import type { QuoteDesk } from "../ports/quote-desk";
import type { UnderwritingTimeline } from "../ports/timeline";
import { PrismaInspectionRepository } from "./prisma-inspection-repository";
import { PrismaReferralRepository } from "./prisma-referral-repository";
import { PrismaSettingsRepository } from "./prisma-settings-repository";
import { PrismaSubjectivityRepository } from "./prisma-subjectivity-repository";
import { PrismaUnderwriterDirectory } from "./prisma-underwriter-directory";

/** The underwriting use cases, shared by the api and worker composition roots. */
export function composeUnderwriting(input: {
  prisma: PrismaClient;
  uow: UnitOfWork;
  outbox: Outbox;
  clocks: ClockProvider;
  storage: ObjectStorage;
  quotes: QuoteDesk;
  timeline: UnderwritingTimeline;
  inspectors: InspectionProviders;
}) {
  const deps: UnderwritingDeps = {
    ...input,
    referrals: new PrismaReferralRepository(),
    subjectivities: new PrismaSubjectivityRepository(),
    inspections: new PrismaInspectionRepository(),
    settings: new PrismaSettingsRepository(),
    staff: new PrismaUnderwriterDirectory(input.prisma),
  };

  return {
    openReferral: makeOpenReferral(deps),
    closeReferrals: makeCloseReferrals(deps),
    closePolicyConditions: makeClosePolicyConditions(deps),
    queue: makeListReferrals(deps),
    referral: makeGetReferral(deps),
    assign: makeAssignReferral(deps),
    requestInfo: makeRequestInfo(deps),
    reply: makeReplyToReferral(deps),
    producerActions: makeListProducerActions(deps),
    note: makeNoteReferral(deps),
    approve: makeApproveReferral(deps),
    decline: makeDeclineReferral(deps),
    syncQuote: makeSyncQuoteConditions(deps),
    outstanding: makeOutstandingConditions(deps),
    subjectivities: makeManageSubjectivities(deps),
    subjectivityTimers: makeSubjectivityTimers(deps),
    inspections: makeListInspections(deps),
    reviewInspection: makeReviewInspection(deps),
    inspectionTimers: makeInspectionTimers(deps),
    settings: makeManageSettings(deps),
    staff: deps.staff,
  };
}

export type Underwriting = ReturnType<typeof composeUnderwriting>;
