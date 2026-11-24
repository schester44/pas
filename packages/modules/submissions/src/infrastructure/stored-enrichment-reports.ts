import type { DocumentContext, Jurisdiction } from "@pas/documents";
import { renderPdf } from "@pas/documents/render";
import { enrichmentSchema, type ReportOutcome } from "@pas/enrichment";
import { newId, type TenantContext } from "@pas/kernel";
import type { ObjectStorage } from "@pas/storage";
import type { MissingReport, StoredReport } from "../domain/enrichment";
import type { EnrichmentReports } from "../ports/enrichment";
import type { CatalogRelease } from "../ports/product-catalog";
import type { DocumentBranding } from "./react-pdf-quote-documents";

type KeepInput = Parameters<EnrichmentReports["keep"]>[1];

/**
 * Keeps enrichment reports in object storage: a vendor's PDF as delivered, or a report rendered
 * from the release's `enrichment_report` template over the stage's data. Both are stored at once,
 * so a report never changes after the data it describes.
 */
export class StoredEnrichmentReports implements EnrichmentReports {
  constructor(
    private readonly deps: {
      storage: ObjectStorage;
      branding: (ctx: TenantContext) => Promise<DocumentBranding>;
      productName: (ctx: TenantContext, productId: string) => Promise<string>;
      jurisdictionName: (jurisdiction: Jurisdiction) => string;
    },
  ) {}

  async keep(ctx: TenantContext, input: KeepInput) {
    const stored: StoredReport[] = [];
    const missing: MissingReport[] = [];

    for (const outcome of input.result.reports) {
      try {
        const report = await this.store(ctx, input, outcome);

        if (report) stored.push(report);
        else if (outcome.source === null) {
          missing.push({
            reportId: outcome.reportId,
            title: outcome.title,
            reason: outcome.reason,
          });
        }
      } catch (error) {
        missing.push({
          reportId: outcome.reportId,
          title: outcome.title,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { stored, missing };
  }

  async read(_ctx: TenantContext, report: StoredReport) {
    return this.deps.storage.get(report.storageKey);
  }

  private async store(
    ctx: TenantContext,
    input: KeepInput,
    outcome: ReportOutcome,
  ): Promise<StoredReport | null> {
    if (outcome.source === null) return null;

    const pdf =
      outcome.source === "vendor"
        ? outcome.artifact
        : {
            bytes: await this.render(ctx, input, outcome.template),
            contentType: "application/pdf",
          };

    const key = `tenants/${ctx.tenantId}/submissions/${input.submissionId}/enrichment/${outcome.reportId}-${newId()}.pdf`;

    await this.deps.storage.put({ key, body: pdf.bytes, contentType: pdf.contentType });

    return {
      reportId: outcome.reportId,
      title: outcome.title,
      source: outcome.source,
      providerId: outcome.source === "vendor" ? outcome.providerId : null,
      storageKey: key,
      contentType: pdf.contentType,
      sizeBytes: pdf.bytes.byteLength,
    };
  }

  private async render(ctx: TenantContext, input: KeepInput, key: string): Promise<Uint8Array> {
    const { release } = input;
    const template = release.documents.templates.find((t) => t.key === key);

    if (!template) throw new Error(`Report template ${key} isn't in the release`);

    return renderPdf({
      template,
      context: await this.context(ctx, input),
      clauses: release.documents.clauses,
      schema: release.riskSchema,
      extraFields: [enrichmentSchema(release.enrichment)],
    });
  }

  private async context(ctx: TenantContext, input: KeepInput): Promise<DocumentContext> {
    const release: CatalogRelease = input.release;
    const today = input.result.snapshot.takenAt.toZonedDateTimeISO("UTC").toPlainDate().toString();

    return {
      tenant: await this.deps.branding(ctx),
      product: {
        name: await this.deps.productName(ctx, release.productId),
        version: release.version,
      },
      policy: {
        effectiveDate: "",
        expirationDate: "",
        issuedDate: today,
        jurisdiction: release.jurisdiction,
        jurisdictionName: this.deps.jurisdictionName(release.jurisdiction),
        transaction: "quote",
      },
      namedInsured: { name: "" },
      risk: input.risk,
      coverages: [],
      forms: [],
      enrichment: { ...input.sources },
    };
  }
}
