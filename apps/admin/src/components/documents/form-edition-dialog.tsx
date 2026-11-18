import { Button } from "@pas/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@pas/ui/components/dialog";
import { jurisdictionName } from "@pas/ui/lib/jurisdictions";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { editionCode, type FormEdition } from "@/components/catalog/documents";
import { formatDate } from "@/lib/format";
import { PdfPreview } from "./pdf-preview";

const fileUrl = (id: string) => `/api/uploads/form-editions/${id}`;

const formatSize = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function FormEditionDialog({
  edition,
  onOpenChange,
}: {
  edition: FormEdition | undefined;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={!!edition} onOpenChange={onOpenChange}>
      <DialogContent className="h-[calc(100dvh-4rem)] max-h-[56rem] gap-0 overflow-hidden p-0 sm:max-w-5xl">
        {edition && <EditionView edition={edition} />}
      </DialogContent>
    </Dialog>
  );
}

function EditionView({ edition }: { edition: FormEdition }) {
  const file = useQuery({
    queryKey: ["form-edition-file", edition.id],
    queryFn: async () => {
      const response = await fetch(fileUrl(edition.id), { credentials: "same-origin" });

      if (!response.ok) throw new Error(`The file didn't load (${response.status})`);

      return new Uint8Array(await response.arrayBuffer());
    },
    staleTime: Infinity,
  });

  const rows: [string, React.ReactNode][] = [
    ["Form", edition.formNumber],
    ["Edition", edition.editionLabel],
    [
      "States",
      edition.jurisdictions.length === 0
        ? "All states"
        : edition.jurisdictions
            .map((code) => jurisdictionName({ country: "US", subdivision: code }))
            .join(", "),
    ],
    ["Carrier", edition.carrier ?? "–"],
    ["Pages", edition.pageCount],
    ["Size", formatSize(edition.sizeBytes)],
    ["Uploaded", formatDate(edition.createdAt)],
    [
      "SHA-256",
      <code key="sha" className="font-mono text-xs break-all">
        {edition.sha256.slice(0, 16)}…
      </code>,
    ],
  ];

  return (
    <div className="grid min-h-0 grid-cols-1 md:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col gap-6 border-b p-6 md:border-r md:border-b-0">
        <div className="grid gap-1 pr-6">
          <DialogTitle className="text-base">{edition.title}</DialogTitle>
          <DialogDescription className="tabular-nums">{editionCode(edition)}</DialogDescription>
        </div>
        <dl className="m-0 grid gap-3 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="grid gap-0.5">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="m-0 tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        <Button asChild variant="outline" size="sm" className="mt-auto self-start">
          <a href={fileUrl(edition.id)} download={`${editionCode(edition)}.pdf`}>
            <Download /> Download
          </a>
        </Button>
      </aside>
      <div className="min-h-0 overflow-y-auto bg-muted/40 p-6">
        {file.error ? (
          <p className="m-0 text-sm text-destructive">{file.error.message}</p>
        ) : (
          <PdfPreview
            data={file.data ?? null}
            label={edition.title}
            className="mx-auto max-w-[42rem]"
          />
        )}
      </div>
    </div>
  );
}
