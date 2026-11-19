import type { PrismaClient } from "@pas/db";
import type { ClockProvider, Outbox, TenantContext, UnitOfWork, Workflows } from "@pas/kernel";
import { asId } from "@pas/kernel";
import type { Logger } from "@pas/observability";
import type { RecordPolicyEvent } from "@pas/policy";
import type { ObjectStorage } from "@pas/storage";
import {
  makeGetQuote,
  makeGetSubmission,
  makeRecordQuoteActivity,
  type ProductCatalog,
} from "@pas/submissions";
import { PrismaQuoteRepository, PrismaSubmissionRepository } from "@pas/submissions/infrastructure";
import {
  inspectionWorkflow,
  type InspectionProviders,
  subjectivityWorkflow,
} from "@pas/underwriting";
import { composeUnderwriting, SubmissionsQuoteDesk } from "@pas/underwriting/infrastructure";
import type { DomainEventHandler } from "./handlers/domain-events";
import { subjectsFrom } from "./workflow-subjects";
import { makeInspectionWorkflow, makeSubjectivityWorkflow } from "./workflows/underwriting";

const contextOf = (tenantId: string): TenantContext => ({
  tenantId: asId(tenantId),
  actor: { type: "system", process: "underwriting" },
});

const submissionOf = (event: { payload: unknown }) =>
  (event.payload as { submissionId: string }).submissionId;

type Tags = Record<string, unknown>;

const timers = (workflows: Workflows) => ({
  inspection: (tenantId: string, inspectionId: string, tags: Tags = {}) =>
    workflows.start(
      contextOf(tenantId),
      inspectionWorkflow,
      { inspectionId },
      {
        idempotencyKey: `underwriting.inspection:${inspectionId}`,
        subjects: subjectsFrom({ ...tags, inspectionId }),
      },
    ),
  subjectivity: (tenantId: string, subjectivityId: string, tags: Tags = {}) =>
    workflows.start(
      contextOf(tenantId),
      subjectivityWorkflow,
      { subjectivityId },
      {
        idempotencyKey: `underwriting.subjectivity:${subjectivityId}`,
        subjects: subjectsFrom({ ...tags, subjectivityId }),
      },
    ),
});

/** Underwriting in the worker: referral intake, conditions, inspections and their timers. */
export function composeWorkerUnderwriting(deps: {
  prisma: PrismaClient;
  uow: UnitOfWork;
  outbox: Outbox;
  clocks: ClockProvider;
  storage: ObjectStorage;
  catalog: ProductCatalog;
  recordPolicyEvent: RecordPolicyEvent;
  inspectors: InspectionProviders;
  logger: Logger;
}) {
  const submissions = new PrismaSubmissionRepository();
  const quotes = new PrismaQuoteRepository();
  const recordQuoteActivity = makeRecordQuoteActivity({ quotes, clocks: deps.clocks });

  const underwriting = composeUnderwriting({
    ...deps,
    quotes: new SubmissionsQuoteDesk({
      get: makeGetSubmission({ uow: deps.uow, submissions, quotes, catalog: deps.catalog }),
      quote: makeGetQuote({ uow: deps.uow, submissions, quotes }),
    }),
    timeline: {
      record: (tx, ctx, { quoteId, policyId, ...entry }) =>
        policyId
          ? deps.recordPolicyEvent(tx, ctx, { policyId, ...entry })
          : recordQuoteActivity(tx, ctx, { quoteId, ...entry }),
    },
  });

  // Starts are idempotent, so a sync also covers a lost start event.
  const sync =
    (workflows: Workflows): DomainEventHandler =>
    async (event) => {
      const ctx = contextOf(event.tenantId);
      const submissionId = submissionOf(event);

      await underwriting.openReferral(ctx, { submissionId });

      const result = await underwriting.syncQuote(ctx, { submissionId });

      const start = timers(workflows);

      const tags = { quoteId: event.aggregateId, submissionId };

      for (const id of result.awaitingOrder) await start.inspection(event.tenantId, id, tags);

      for (const id of result.awaitingDue) await start.subjectivity(event.tenantId, id, tags);
    };

  const close =
    (reason: string): DomainEventHandler =>
    async (event) =>
      underwriting.closeReferrals(contextOf(event.tenantId), {
        quoteId: event.aggregateId,
        reason,
      });

  return {
    underwriting,
    workflows: [
      makeInspectionWorkflow({ timers: underwriting.inspectionTimers }),
      makeSubjectivityWorkflow({ timers: underwriting.subjectivityTimers }),
    ],
    handlers: (workflows: Workflows): Record<string, DomainEventHandler[]> => ({
      "submissions.quote_referred": [
        async (event) => {
          const result = await underwriting.openReferral(contextOf(event.tenantId), {
            submissionId: submissionOf(event),
          });

          deps.logger.info({ quoteId: event.aggregateId, ...result }, "referral");
        },
        sync(workflows),
      ],
      "submissions.quote_created": [sync(workflows)],
      "submissions.quote_requoted": [sync(workflows)],
      "submissions.quote_approved": [sync(workflows)],
      "submissions.quote_bound": [sync(workflows)],
      "submissions.quote_expired": [close("Quote expired before a decision")],
      "submissions.quote_declined": [
        async (event) => {
          if ((event.payload as { by?: string }).by === "rules") {
            await close("Declined by the rules on a requote")(event);
          }
        },
      ],
      "underwriting.inspection_requested": [
        async (event) => {
          const { inspectionId } = event.payload as { inspectionId: string };

          await timers(workflows).inspection(event.tenantId, inspectionId, event.payload as Tags);
        },
      ],
      "underwriting.subjectivity_activated": [
        async (event) => {
          const { subjectivityId } = event.payload as { subjectivityId: string };

          await timers(workflows).subjectivity(
            event.tenantId,
            subjectivityId,
            event.payload as Tags,
          );
        },
      ],
      "underwriting.subjectivity_overdue": [
        async (event) =>
          deps.logger.warn({ event }, "post-bind subjectivity overdue; consequence raised"),
      ],
    }),
  };
}
