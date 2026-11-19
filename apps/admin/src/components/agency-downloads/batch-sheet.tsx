import { Button } from "@pas/ui/components/button";
import { Notice } from "@pas/ui/components/notice";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@pas/ui/components/sheet";
import { Spinner } from "@pas/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { formatDateTime, formatPlainDate } from "@/lib/format";
import { useAccess } from "@/lib/permissions";
import { useTRPC } from "@/lib/trpc";
import {
  BatchStatus,
  FORMAT_LABELS,
  fileSize,
  fromBase64,
  mailboxOf,
  saveFile,
  TRIGGER_LABELS,
} from "./shared";

/** One delivered file: what it carried, the file itself, and a resend. */
export function BatchSheet({
  batchId,
  onOpenChange,
}: {
  batchId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const trpc = useTRPC();
  const access = useAccess();
  const queryClient = useQueryClient();

  const detail = useQuery({
    ...trpc.agencyDownloads.batch.queryOptions({ id: batchId ?? "" }),
    enabled: !!batchId,
  });

  const resend = useMutation(
    trpc.agencyDownloads.resendBatch.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.agencyDownloads.pathKey() }),
    }),
  );

  async function download() {
    const file = await queryClient.fetchQuery(
      trpc.agencyDownloads.file.queryOptions({ id: batchId! }),
    );

    saveFile(file.fileName, file.contentType, fromBase64(file.base64));
  }

  const batch = detail.data?.batch;

  return (
    <Sheet open={!!batchId} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle className="font-mono text-base tabular-nums">
            {batch?.fileName ?? "Download file"}
          </SheetTitle>
          <SheetDescription>
            {batch
              ? `${batch.agencyName} · ${mailboxOf(batch)} · ${TRIGGER_LABELS[batch.trigger]}`
              : "Loading"}
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          {detail.error && (
            <Notice tone="error" title="Couldn't load this file">
              {detail.error.message}
            </Notice>
          )}
          {batch && (
            <>
              <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
                <Fact label="Status">
                  <BatchStatus status={batch.status} />
                </Fact>
                <Fact label="Format">{FORMAT_LABELS[batch.format] ?? batch.format}</Fact>
                <Fact label="Items">
                  <span className="tabular-nums">{batch.itemCount}</span>
                </Fact>
                <Fact label="Size">
                  <span className="tabular-nums">{fileSize(batch.sizeBytes)}</span>
                </Fact>
                <Fact label="Sent">
                  <span className="tabular-nums">{formatDateTime(batch.createdAt)}</span>
                </Fact>
                <Fact label="Transport">
                  {batch.transport === "test_mailbox" ? "Test mailbox" : "IVANS network"}
                </Fact>
                <Fact label="Reference">
                  <span className="font-mono text-xs break-all">{batch.reference ?? "—"}</span>
                </Fact>
              </dl>
              {batch.error && (
                <Notice tone="error" title="Not delivered">
                  {batch.error}
                </Notice>
              )}
              {resend.error && (
                <Notice tone="error" title="Couldn't resend">
                  {resend.error.message}
                </Notice>
              )}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={download}>
                  <Download /> Download file
                </Button>
                {access.agencies.write && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={resend.isPending}
                    onClick={() => resend.mutate({ batchId: batch.id })}
                  >
                    {resend.isPending && <Spinner />}
                    Resend file
                  </Button>
                )}
              </div>
              {resend.data && (
                <p className="m-0 text-sm text-muted-foreground">
                  {resend.data.status === "delivered"
                    ? "Resent as a new delivery."
                    : `Resend failed: ${resend.data.error}`}
                </p>
              )}
              <section className="grid gap-2">
                <h3 className="m-0 text-sm font-medium">Contents</h3>
                <ul className="m-0 list-none divide-y rounded-lg border p-0 text-sm">
                  {detail.data!.items.map((item) => (
                    <li key={item.id} className="flex justify-between gap-3 px-3 py-2">
                      <span className="truncate">{item.title}</span>
                      <span className="shrink-0 text-muted-foreground tabular-nums">
                        {item.effectiveDate ? formatPlainDate(item.effectiveDate) : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
              <section className="grid gap-2">
                <h3 className="m-0 text-sm font-medium">File</h3>
                <pre className="m-0 max-h-[60vh] overflow-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-5">
                  {detail.data!.preview}
                </pre>
                {detail.data!.truncated && (
                  <p className="m-0 text-xs text-muted-foreground">
                    Showing the first 512 KB. Download the file for the rest.
                  </p>
                )}
              </section>
            </>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="m-0">{children}</dd>
    </div>
  );
}
