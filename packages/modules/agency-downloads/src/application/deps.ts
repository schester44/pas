import type { ClockProvider, Outbox, TenantContext, UnitOfWork, Workflows } from "@pas/kernel";
import type { ObjectStorage } from "@pas/storage";
import type { AgencyDownloadChannels } from "../ports/channel";
import type { DownloadFormat } from "../ports/format";
import type { BatchRepository, EnrollmentRepository, ItemRepository } from "../ports/repositories";
import type { AgencySource, DownloadObligations, TransactionSource } from "../ports/sources";

export interface AgencyDownloadsDeps {
  uow: UnitOfWork;
  outbox: Outbox;
  clocks: ClockProvider;
  storage: ObjectStorage;
  enrollments: EnrollmentRepository;
  items: ItemRepository;
  batches: BatchRepository;
  channels: AgencyDownloadChannels;
  formats: Readonly<Record<string, DownloadFormat>>;
  transactions: TransactionSource;
  agencies: AgencySource;
  obligations: DownloadObligations;
  tenantName: (ctx: TenantContext) => Promise<string>;
  /** Only the worker runs batches; the API just starts them. */
  workflows: () => Workflows;
}

export const obligationKey = (itemKey: string) => `ams_download:${itemKey}`;
