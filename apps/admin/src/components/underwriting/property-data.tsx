import { EnrichmentPanel } from "@pas/ui/components/enrichment-panel";
import { downloadPdf } from "@pas/ui/lib/download";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/lib/trpc";

/** The enrichment a quote was rated on, for underwriters. Nothing when the product has none. */
export function PropertyData({ submissionId }: { submissionId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data } = useQuery(trpc.submissions.quoteEnrichment.queryOptions({ submissionId }));

  if (!data) return null;

  return (
    <EnrichmentPanel
      data={data}
      labelFor={(path) => data.labels[path] ?? path}
      onOpenReport={async ({ recordId, reportId }) => {
        const file = await queryClient.fetchQuery(
          trpc.submissions.enrichmentReport.queryOptions({ submissionId, recordId, reportId }),
        );

        downloadPdf(file.pdf, file.title);
      }}
    />
  );
}
