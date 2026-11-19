import type { ClockProvider, Outbox, TenantContext, UnitOfWork, Workflows } from "@pas/kernel";
import type { ObjectStorage } from "@pas/storage";
import type { AgencyDownloadsDeps } from "../application/deps";
import { makeCaptureTransaction } from "../application/capture-transaction";
import { makeGenerateSamples } from "../application/generate-samples";
import { makeListDownloads } from "../application/list-downloads";
import { makeManageEnrollments } from "../application/manage-enrollments";
import { makeResendDownload } from "../application/resend-download";
import { makeNightlyBatch } from "../application/run-nightly-batch";
import { makeSendCommissionStatement } from "../application/send-commission-statement";
import type { TrackObligations } from "@pas/compliance";
import type { AgencyStatement, ManageAgencies } from "@pas/distribution";
import type { AgencyDownloadChannels } from "../ports/channel";
import { distributionAgencySource } from "./agency-source";
import { complianceDownloadObligations } from "./compliance-obligations";
import { policyTransactionSource } from "./policy-source";
import { acordXmlFormat } from "./formats/acord-xml";
import { al3PlaceholderFormat } from "./formats/al3-placeholder";
import {
  PrismaBatchRepository,
  PrismaEnrollmentRepository,
  PrismaItemRepository,
} from "./prisma-repositories";

export const DOWNLOAD_FORMATS_BY_ID = {
  [acordXmlFormat.id]: acordXmlFormat,
  [al3PlaceholderFormat.id]: al3PlaceholderFormat,
};

/** The agency downloads use cases, shared by the api and worker composition roots. */
export function composeAgencyDownloads(input: {
  uow: UnitOfWork;
  outbox: Outbox;
  clocks: ClockProvider;
  storage: ObjectStorage;
  channels: AgencyDownloadChannels;
  policy: Parameters<typeof policyTransactionSource>[0];
  agencies: Pick<ManageAgencies, "list">;
  statements: Pick<AgencyStatement, "statement">;
  obligations: TrackObligations;
  tenantName: (ctx: TenantContext) => Promise<string>;
  workflows: () => Workflows;
}) {
  const deps: AgencyDownloadsDeps = {
    uow: input.uow,
    outbox: input.outbox,
    clocks: input.clocks,
    storage: input.storage,
    channels: input.channels,
    tenantName: input.tenantName,
    workflows: input.workflows,
    transactions: policyTransactionSource(input.policy),
    agencies: distributionAgencySource(input),
    obligations: complianceDownloadObligations(input.obligations, input.tenantName),
    enrollments: new PrismaEnrollmentRepository(),
    items: new PrismaItemRepository(),
    batches: new PrismaBatchRepository(),
    formats: DOWNLOAD_FORMATS_BY_ID,
  };

  return {
    enrollments: makeManageEnrollments(deps),
    capture: makeCaptureTransaction(deps),
    nightly: makeNightlyBatch(deps),
    resend: makeResendDownload(deps),
    sendStatement: makeSendCommissionStatement(deps),
    downloads: makeListDownloads(deps),
    samples: makeGenerateSamples(deps),
  };
}

export type AgencyDownloads = ReturnType<typeof composeAgencyDownloads>;
