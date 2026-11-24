import { enrichmentSchema, sampleSources } from "@pas/enrichment";
import {
  buildPacket,
  type DocumentContext,
  type DocumentTemplate,
  type FormsScheduleRow,
  type Jurisdiction,
  type Packet,
  sampleContext,
  scheduleContextOf,
  type TransactionType,
} from "@pas/documents";
import { mergePdfs, renderPdf } from "@pas/documents/render";
import { useExpressionsReady } from "@pas/forms-react";
import { jurisdictionName } from "@pas/ui/lib/jurisdictions";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { FormEdition } from "@/components/catalog/documents";
import type { Contents } from "@/components/catalog/version-editor";
import { useTRPC } from "@/lib/trpc";

export interface PreviewScenario {
  jurisdiction: Jurisdiction;
  transaction: TransactionType;
  coverages?: readonly string[];
}

export function useFormEditions(enabled = true) {
  const trpc = useTRPC();

  return useQuery({ ...trpc.documents.formEditions.list.queryOptions(), enabled });
}

function formRows(packet: Packet, editions: readonly FormEdition[]): FormsScheduleRow[] {
  return packet.entries.flatMap((entry) => {
    if (entry.document.kind !== "form") return [];

    const id = entry.document.editionId;
    const edition = editions.find((candidate) => candidate.id === id);

    return edition
      ? [{ number: edition.formNumber, edition: edition.editionLabel, title: edition.title }]
      : [];
  });
}

/** Sample data for previews, with the packet the schedule would build for this scenario. */
export function usePreviewContext(
  contents: Contents,
  productName: string,
  version: string,
  scenario: PreviewScenario,
): { context: DocumentContext; packet: Packet } | null {
  const trpc = useTRPC();
  const ready = useExpressionsReady();
  const profile = useQuery(trpc.tenant.profile.get.queryOptions());
  const editions = useFormEditions();
  const { jurisdiction, transaction, coverages } = scenario;

  const window = contents.availability.find(
    (w) => (w.jurisdiction.subdivision ?? null) === (jurisdiction.subdivision ?? null),
  );

  return useMemo(() => {
    if (!ready || !profile.data) return null;

    const context = sampleContext({
      schema: contents.riskSchema,
      coverages: contents.coverages,
      ...(coverages && { selected: coverages }),
      tenant: {
        name: profile.data.displayName,
        primaryColor: profile.data.primaryColor,
        ...(profile.data.supportEmail && { supportEmail: profile.data.supportEmail }),
        ...(profile.data.supportPhone && { supportPhone: profile.data.supportPhone }),
      },
      product: { name: productName, version },
      jurisdiction,
      jurisdictionName: jurisdictionName(jurisdiction),
      transaction,
      ...(window && { effectiveDate: window.newBusiness.from }),
    });

    const packet = buildPacket(contents.documents.schedule, scheduleContextOf(context));
    const enrichment = { ...sampleSources(contents.enrichment, context.risk) };

    return {
      context: { ...context, forms: formRows(packet, editions.data ?? []), enrichment },
      packet,
    };
  }, [
    ready,
    profile.data,
    contents,
    coverages,
    productName,
    version,
    jurisdiction,
    transaction,
    window,
    editions.data,
  ]);
}

/** Re-renders the template after edits settle, keeping the last good PDF on screen meanwhile. */
export function useTemplatePdf(
  template: DocumentTemplate | undefined,
  context: DocumentContext | null,
  contents: Contents,
  delay = 450,
) {
  const [state, setState] = useState<{
    data: Uint8Array | null;
    error: string | null;
    input: unknown;
  }>({ data: null, error: null, input: null });

  const input = useMemo(
    () => (template && context ? { template, context, contents } : null),
    [template, context, contents],
  );

  useEffect(() => {
    if (!template || !context) return;

    let cancelled = false;

    const timer = setTimeout(() => {
      renderPdf({
        template,
        context,
        clauses: contents.documents.clauses,
        schema: contents.riskSchema,
        extraFields: [enrichmentSchema(contents.enrichment)],
      }).then(
        (data) => !cancelled && setState({ data, error: null, input }),
        (cause: unknown) =>
          !cancelled && setState((prev) => ({ ...prev, error: (cause as Error).message, input })),
      );
    }, delay);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    template,
    context,
    contents.documents.clauses,
    contents.riskSchema,
    contents.enrichment,
    delay,
    input,
  ]);

  return {
    data: state.data,
    error: state.error,
    rendering: input !== null && state.input !== input,
  };
}

export async function renderPacketPdf(
  packet: Packet,
  context: DocumentContext,
  contents: Contents,
): Promise<Uint8Array> {
  const parts = await Promise.all(
    packet.entries.map(async (entry) => {
      const document = entry.document;

      if (document.kind === "template") {
        const template = contents.documents.templates.find((t) => t.key === document.key);

        if (!template) return null;

        return renderPdf({
          template,
          context,
          clauses: contents.documents.clauses,
          schema: contents.riskSchema,
          extraFields: [enrichmentSchema(contents.enrichment)],
        });
      }

      const response = await fetch(`/api/uploads/form-editions/${document.editionId}`, {
        credentials: "same-origin",
      });

      if (!response.ok) throw new Error(`Couldn't load a form edition (${response.status})`);

      return new Uint8Array(await response.arrayBuffer());
    }),
  );

  return mergePdfs(parts.filter((part): part is Uint8Array => part !== null));
}
