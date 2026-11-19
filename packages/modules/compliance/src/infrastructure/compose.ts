import type { ClockProvider, Outbox, TenantContext, UnitOfWork } from "@pas/kernel";
import type { ObjectStorage } from "@pas/storage";
import { makeCorrectObligation } from "../application/correct-obligation";
import { makeCreateTransactionObligations } from "../application/create-transaction-obligations";
import type { ComplianceDeps } from "../application/deps";
import { makeExportFilingBatch } from "../application/export-filing-batch";
import { makeGetObligation } from "../application/get-obligation";
import { makeListObligations } from "../application/list-obligations";
import { makeManageLicensees } from "../application/manage-licensees";
import { makeMarkObligationSubmitted } from "../application/mark-obligation-submitted";
import { makeObligationTimers } from "../application/obligation-timers";
import { makeRecordFilingResponse } from "../application/record-filing-response";
import { makeRemittanceReport } from "../application/remittance-report";
import { makeSubmitObligation } from "../application/submit-obligation";
import { makeTrackObligations } from "../application/track-obligations";
import { makeWaiveObligation } from "../application/waive-obligation";
import type { FilingChannels } from "../ports/filing-channel";
import type { PolicySource, PolicyTimeline } from "../ports/policy-source";
import { PrismaLicenseeRepository } from "./prisma-licensee-repository";
import { PrismaObligationRepository } from "./prisma-obligation-repository";

/** The compliance use cases, shared by the api and worker composition roots. */
export function composeCompliance(input: {
  uow: UnitOfWork;
  outbox: Outbox;
  clocks: ClockProvider;
  storage: ObjectStorage;
  policies: PolicySource;
  timeline: PolicyTimeline;
  channels: FilingChannels;
  tenantName: (ctx: TenantContext) => Promise<string>;
}) {
  const deps: ComplianceDeps = {
    ...input,
    obligations: new PrismaObligationRepository(),
    licensees: new PrismaLicenseeRepository(),
  };

  const batches = makeExportFilingBatch(deps);

  return {
    createForTransaction: makeCreateTransactionObligations({
      ...deps,
      tenantName: input.tenantName,
    }),
    obligations: makeListObligations(deps),
    obligation: makeGetObligation(deps),
    submit: makeSubmitObligation({ ...deps, exportBatch: batches.export }),
    batches,
    markSubmitted: makeMarkObligationSubmitted(deps),
    recordResponse: makeRecordFilingResponse(deps),
    correct: makeCorrectObligation(deps),
    waive: makeWaiveObligation(deps),
    remittanceReport: makeRemittanceReport(deps),
    licensees: makeManageLicensees(deps),
    timers: makeObligationTimers(deps),
    tracked: makeTrackObligations(deps),
  };
}

export type Compliance = ReturnType<typeof composeCompliance>;
