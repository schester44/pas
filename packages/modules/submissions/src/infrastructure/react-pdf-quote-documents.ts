import {
  buildPacket,
  documentRef,
  type DocumentContext,
  type FormsScheduleRow,
  type Jurisdiction,
  type ScheduleEntry,
} from "@pas/documents";
import { mergePdfs, renderPdf } from "@pas/documents/render";
import type { GetFormEditionFile } from "@pas/form-library";
import { type BindingInvoker, bindingsAt, noExtensions } from "@pas/extension-points";
import type { TenantContext } from "@pas/kernel";
import type { CatalogRelease } from "../ports/product-catalog";
import type { QuoteDocuments, RenderedPacket } from "../ports/quote-documents";

type Input = Parameters<QuoteDocuments["render"]>[1];

export interface DocumentBranding {
  name: string;
  primaryColor: string;
  supportEmail?: string;
  supportPhone?: string;
}

/** Renders the release's schedule with react-pdf and merges in library form editions. */
export class ReactPdfQuoteDocuments implements QuoteDocuments {
  constructor(
    private readonly deps: {
      formEdition: GetFormEditionFile;
      branding: (ctx: TenantContext) => Promise<DocumentBranding>;
      jurisdictionName: (jurisdiction: Jurisdiction) => string;
      extensions?: BindingInvoker;
    },
  ) {}

  /** `document_select`: the extension adds schedule entries by id or removes them. */
  private async select(
    ctx: TenantContext,
    release: CatalogRelease,
    transaction: string,
    entries: ScheduleEntry[],
    hook: Record<string, unknown>,
  ): Promise<ScheduleEntry[]> {
    const [binding] = bindingsAt(release.extensions, "document_select");

    if (!binding) return entries;

    const output = await (this.deps.extensions ?? noExtensions).invoke(ctx, binding, {
      ...hook,
      transaction,
      scheduled: entries.map((e) => ({ id: e.id, document: documentRef(e.document) })),
      available: release.documents.schedule.map((e) => ({
        id: e.id,
        document: documentRef(e.document),
      })),
    });

    if (!output) return entries;

    const removed = new Set(output.remove);
    const present = new Set(entries.map((e) => e.id));

    const added = release.documents.schedule.filter(
      (e) => output.add.includes(e.id) && !present.has(e.id),
    );

    return [...entries.filter((e) => !removed.has(e.id)), ...added].toSorted(
      (a, b) => a.order - b.order,
    );
  }

  /** `document_data`: extra values templates can merge as `extension.*`. */
  private async extensionData(
    ctx: TenantContext,
    release: CatalogRelease,
    hook: Record<string, unknown>,
  ): Promise<Record<string, unknown> | undefined> {
    const bindings = bindingsAt(release.extensions, "document_data");

    if (bindings.length === 0) return undefined;

    const outputs = await Promise.all(
      bindings.map((b) => (this.deps.extensions ?? noExtensions).invoke(ctx, b, hook)),
    );

    return Object.assign({}, ...outputs.map((o) => o?.data ?? {}));
  }

  async render(ctx: TenantContext, input: Input): Promise<RenderedPacket> {
    const { release, context, transactions } = input;
    const coverages = [...new Set(context.coverages.map((coverage) => coverage.code))];
    const tenant = await this.deps.branding(ctx);
    const seen = new Set<string>();

    const hook = {
      jurisdiction: context.policy.jurisdiction,
      product: { id: release.productId, version: release.version },
      policy: {
        number: context.policy.number ?? null,
        effectiveDate: context.policy.effectiveDate,
      },
      risk: context.risk,
      coverages,
      premium: context.premium?.total ?? null,
    };

    const packets = await Promise.all(
      transactions.map(async (transaction) => {
        const packet = buildPacket(release.documents.schedule, {
          jurisdiction: context.policy.jurisdiction,
          transaction,
          coverages,
          risk: context.risk,
        });

        return {
          transaction,
          entries: await this.select(ctx, release, transaction, packet.entries, hook),
        };
      }),
    );

    const extension = await this.extensionData(ctx, release, hook);

    const editions = await this.editions(
      ctx,
      packets.flatMap((p) => p.entries),
    );

    const parts: { pdf: Uint8Array; title: string; kind: "template" | "form" }[] = [];

    for (const { transaction, entries } of packets) {
      const forms = entries.flatMap((entry) => {
        const edition =
          entry.document.kind === "form" ? editions.get(entry.document.editionId) : undefined;

        return edition ? [edition.row] : [];
      });

      const full: DocumentContext = {
        ...context,
        tenant,
        policy: {
          ...context.policy,
          transaction,
          jurisdictionName: this.deps.jurisdictionName(context.policy.jurisdiction),
        },
        forms,
        ...(extension && { extension }),
      };

      for (const entry of entries) {
        const ref = documentRef(entry.document);

        if (seen.has(ref)) continue;

        seen.add(ref);
        const part = await this.renderEntry(release, entry, full, editions);

        if (part) parts.push(part);
      }
    }

    return {
      pdf: await mergePdfs(parts.map((part) => part.pdf)),
      documents: parts.map(({ title, kind }) => ({ title, kind })),
    };
  }

  private async editions(ctx: TenantContext, entries: readonly ScheduleEntry[]) {
    const ids = [
      ...new Set(
        entries.flatMap((entry) =>
          entry.document.kind === "form" ? [entry.document.editionId] : [],
        ),
      ),
    ];

    const files = await Promise.all(ids.map((id) => this.deps.formEdition(ctx, { id })));

    return new Map(
      files.map(({ edition, body }) => {
        const row: FormsScheduleRow = {
          number: edition.formNumber,
          edition: edition.editionLabel,
          title: edition.title,
        };

        return [edition.id, { row, body, title: `${edition.formNumber} ${edition.title}` }];
      }),
    );
  }

  private async renderEntry(
    release: CatalogRelease,
    entry: ScheduleEntry,
    context: DocumentContext,
    editions: Map<string, { body: Uint8Array; title: string }>,
  ) {
    const document = entry.document;

    if (document.kind === "form") {
      const edition = editions.get(document.editionId);

      return edition ? { pdf: edition.body, title: edition.title, kind: "form" as const } : null;
    }

    const template = release.documents.templates.find((t) => t.key === document.key);

    if (!template) return null;

    const pdf = await renderPdf({
      template,
      context,
      clauses: release.documents.clauses,
      schema: release.riskSchema,
    });

    return { pdf, title: template.title, kind: "template" as const };
  }
}
