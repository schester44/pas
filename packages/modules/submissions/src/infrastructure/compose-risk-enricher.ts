import type { Jurisdiction } from "@pas/documents";
import {
  createCircuitBreaker,
  InMemoryEnrichmentCache,
  type TransformRunner,
} from "@pas/enrichment";
import { type ClockProvider, systemClock, type TenantContext, type UnitOfWork } from "@pas/kernel";
import type { ObjectStorage } from "@pas/storage";
import { makeRiskEnricher } from "../application/enrich-risk";
import type { DataProviders } from "../ports/enrichment";
import type { RiskEnricher } from "../ports/risk-enricher";
import { PrismaEnrichmentRecordRepository } from "./prisma-enrichment-record-repository";
import type { DocumentBranding } from "./react-pdf-quote-documents";
import { StoredEnrichmentReports } from "./stored-enrichment-reports";

/** The enrichment pipeline for quoting: Prisma records, object-storage reports, in-process cache. */
export function composeRiskEnricher(deps: {
  uow: UnitOfWork;
  clocks: ClockProvider;
  storage: ObjectStorage;
  providers: DataProviders;
  branding: (ctx: TenantContext) => Promise<DocumentBranding>;
  productName: (ctx: TenantContext, productId: string) => Promise<string>;
  jurisdictionName: (jurisdiction: Jurisdiction) => string;
  transforms?: { for(ctx: TenantContext): TransformRunner };
}): {
  enricher: RiskEnricher;
  reports: StoredEnrichmentReports;
  records: PrismaEnrichmentRecordRepository;
} {
  const records = new PrismaEnrichmentRecordRepository();
  const reports = new StoredEnrichmentReports(deps);

  const enricher = makeRiskEnricher({
    uow: deps.uow,
    clocks: deps.clocks,
    records,
    reports,
    providers: deps.providers,
    cache: new InMemoryEnrichmentCache(systemClock),
    breaker: createCircuitBreaker(systemClock),
    ...(deps.transforms && { transforms: deps.transforms }),
  });

  return { enricher, reports, records };
}
