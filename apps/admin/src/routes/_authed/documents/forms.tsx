import { Button } from "@pas/ui/components/button";
import { EmptyState } from "@pas/ui/components/empty-state";
import { Notice } from "@pas/ui/components/notice";
import { PageBody, PageHeader } from "@pas/ui/components/page";
import { Panel } from "@pas/ui/components/panel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@pas/ui/components/table";
import { cn } from "@pas/ui/lib/utils";
import { createFileRoute } from "@tanstack/react-router";
import { FileStack, Upload } from "lucide-react";
import { SkeletonRows } from "@/components/catalog/skeleton-rows";
import { FormEditionDialog } from "@/components/documents/form-edition-dialog";
import { useFormEditions } from "@/components/documents/preview";
import { UploadFormDialog } from "@/components/documents/upload-form-dialog";
import { formatDate } from "@/lib/format";
import { useAccess } from "@/lib/permissions";

interface LibrarySearch {
  upload?: boolean;
  edition?: string;
}

export const Route = createFileRoute("/_authed/documents/forms")({
  validateSearch: (search: Record<string, unknown>): LibrarySearch => ({
    ...(search.upload === true && { upload: true }),
    ...(typeof search.edition === "string" && { edition: search.edition }),
  }),
  component: FormsLibrary,
});

const states = (codes: string[]) =>
  codes.length === 0 ? "All" : codes.map((code) => code.split("-").at(-1)).join(", ");

function FormsLibrary() {
  const access = useAccess();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const editions = useFormEditions(access.documents.read);
  const list = editions.data ?? [];
  const selected = list.find((edition) => edition.id === search.edition);

  const uploadAction = access.documents.write && (
    <Button size="sm" onClick={() => navigate({ search: { upload: true } })}>
      <Upload /> Upload form
    </Button>
  );

  return (
    <>
      <PageHeader title="Forms library" actions={list.length > 0 && uploadAction} />
      <PageBody className="max-w-6xl">
        {editions.error && (
          <Notice tone="error" title="Couldn't load the forms library">
            {editions.error.message}
          </Notice>
        )}
        <Panel
          title="Form editions"
          description="Filed policy forms and endorsements that schedules attach to packets."
          flush
        >
          {!editions.isPending && list.length === 0 ? (
            <EmptyState
              icon={<FileStack />}
              title="No forms yet"
              description="Upload filed policy forms as PDFs, one edition at a time."
              action={uploadAction}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Form</TableHead>
                  <TableHead>Edition</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>States</TableHead>
                  <TableHead className="text-right">Pages</TableHead>
                  <TableHead className="text-right">Uploaded</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {editions.isPending && <SkeletonRows columns={6} />}
                {list.map((edition) => (
                  <TableRow
                    key={edition.id}
                    aria-selected={edition.id === selected?.id}
                    className={cn(
                      "cursor-pointer",
                      edition.id === selected?.id ? "bg-primary/5" : "hover:bg-muted/40",
                    )}
                    onClick={() => navigate({ search: { edition: edition.id } })}
                  >
                    <TableCell className="font-medium whitespace-nowrap tabular-nums">
                      {edition.formNumber}
                    </TableCell>
                    <TableCell className="tabular-nums">{edition.editionLabel}</TableCell>
                    <TableCell className="max-w-80 truncate">{edition.title}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {states(edition.jurisdictions)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{edition.pageCount}</TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums">
                      {formatDate(edition.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Panel>
      </PageBody>
      <UploadFormDialog
        open={!!search.upload}
        onOpenChange={(open) => !open && navigate({ search: {} })}
        onUploaded={(edition) => navigate({ search: { edition: edition.id } })}
      />
      <FormEditionDialog
        edition={selected}
        onOpenChange={(open) => !open && navigate({ search: {} })}
      />
    </>
  );
}
