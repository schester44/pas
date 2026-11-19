import { Button } from "@pas/ui/components/button";
import { EmptyState } from "@pas/ui/components/empty-state";
import { Panel } from "@pas/ui/components/panel";
import { Spinner } from "@pas/ui/components/spinner";
import { useQueryClient } from "@tanstack/react-query";
import { Download, FileText } from "lucide-react";
import { useState } from "react";
import { formatDate } from "@/lib/format";
import { useTRPC } from "@/lib/trpc";
import type { Policy } from "./policy-format";

const fromBase64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

const size = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Generated policy documents, newest first, each downloadable as a PDF. */
export function PolicyDocuments({ policy }: { policy: Policy }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const documents = policy.documents.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));

  async function download(documentId: string) {
    setBusy(documentId);

    try {
      const file = await queryClient.fetchQuery(
        trpc.policies.document.queryOptions({ policyId: policy.id, documentId }),
      );

      const url = URL.createObjectURL(
        new Blob([fromBase64(file.pdf)], { type: "application/pdf" }),
      );

      const link = document.createElement("a");
      link.href = url;
      link.download = file.fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel flush>
      {documents.length === 0 ? (
        <EmptyState title="No documents generated yet" />
      ) : (
        <ul className="m-0 list-none divide-y p-0">
          {documents.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-(--card-p) py-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <FileText aria-hidden className="size-4" />
              </span>
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate text-sm font-medium">{d.title}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatDate(d.createdAt)} · {size(d.sizeBytes)}
                </span>
              </span>
              <Button
                variant="outline"
                size="sm"
                aria-label={`Download ${d.title}`}
                disabled={busy === d.id}
                onClick={() => download(d.id)}
              >
                {busy === d.id ? <Spinner /> : <Download />}
                <span className="hidden sm:inline">Download</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
