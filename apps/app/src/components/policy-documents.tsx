import { Button } from "@pas/ui/components/button";
import { Spinner } from "@pas/ui/components/spinner";
import { useQueryClient } from "@tanstack/react-query";
import { Download, FileText } from "lucide-react";
import { useState } from "react";
import { formatBytes } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";

const fromBase64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

type DocumentFile = { fileName: string; pdf: string };

export function PolicyDocumentList({
  policyId,
  documents,
  audience = "agent",
}: {
  policyId: string;
  documents: { id: string; title: string; sizeBytes: number; detail?: string }[] | undefined;
  audience?: "agent" | "client";
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [downloading, setDownloading] = useState<string | null>(null);

  async function download(documentId: string) {
    setDownloading(documentId);

    try {
      const input = { policyId, documentId };

      const file: DocumentFile =
        audience === "client"
          ? await queryClient.fetchQuery(trpc.client.documents.download.queryOptions(input))
          : await queryClient.fetchQuery(trpc.policies.document.queryOptions(input));

      const url = URL.createObjectURL(
        new Blob([fromBase64(file.pdf)], { type: "application/pdf" }),
      );

      const link = document.createElement("a");
      link.href = url;
      link.download = file.fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setDownloading(null);
    }
  }

  return (
    <ul className="m-0 list-none divide-y p-0">
      {!documents &&
        [0, 1].map((i) => (
          <li key={i} className="px-(--card-p) py-3.5">
            <div className="h-5 w-56 animate-pulse rounded bg-muted" />
          </li>
        ))}
      {documents?.map((doc) => (
        <li key={doc.id} className="flex items-center gap-3 px-(--card-p) py-3">
          <FileText aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="grid min-w-0 flex-1">
            <span className="truncate text-sm font-medium">{doc.title}</span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {doc.detail && `${doc.detail} · `}PDF · {formatBytes(doc.sizeBytes)}
            </span>
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={downloading === doc.id}
            aria-label={`Download ${doc.title}`}
            onClick={() => download(doc.id)}
          >
            {downloading === doc.id ? <Spinner /> : <Download />}
            <span className="hidden sm:inline">Download</span>
          </Button>
        </li>
      ))}
    </ul>
  );
}
