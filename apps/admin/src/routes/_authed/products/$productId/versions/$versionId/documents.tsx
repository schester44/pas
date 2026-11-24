import { type DocumentSet, TEMPLATE_KINDS, type TemplateKind } from "@pas/documents";
import { enrichmentSchema } from "@pas/enrichment";
import { Button } from "@pas/ui/components/button";
import { Card } from "@pas/ui/components/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@pas/ui/components/dialog";
import { EmptyState } from "@pas/ui/components/empty-state";
import { Input } from "@pas/ui/components/input";
import { Label } from "@pas/ui/components/label";
import { PageBody } from "@pas/ui/components/page";
import { SegmentedControl } from "@pas/ui/components/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pas/ui/components/select";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { LayoutTemplate, Plus } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/catalog/confirm-dialog";
import {
  blankTemplate,
  type DocumentSection,
  TEMPLATE_KIND_LABELS,
} from "@/components/catalog/documents";
import { useVersionEditor } from "@/components/catalog/version-editor";
import { ClausesEditor } from "@/components/documents/clauses-editor";
import { DocumentFieldsProvider } from "@/components/documents/document-fields";
import { useFormEditions } from "@/components/documents/preview";
import { ScheduleEditor } from "@/components/documents/schedule-editor";
import { TemplateEditor } from "@/components/documents/template-editor";
import { useAccess } from "@/lib/permissions";
import { useTRPC } from "@/lib/trpc";

interface DocumentsSearch {
  section?: DocumentSection;
  item?: string;
  block?: string;
}

const SECTIONS = ["templates", "clauses", "schedule"] as const;

export const Route = createFileRoute("/_authed/products/$productId/versions/$versionId/documents")({
  validateSearch: (search: Record<string, unknown>): DocumentsSearch => ({
    ...(SECTIONS.includes(search.section as DocumentSection) && {
      section: search.section as DocumentSection,
    }),
    ...(typeof search.item === "string" && { item: search.item }),
    ...(typeof search.block === "string" && { block: search.block }),
  }),
  component: DocumentsTab,
});

function DocumentsTab() {
  const trpc = useTRPC();
  const access = useAccess();
  const { version, contents, set } = useVersionEditor();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const product = useQuery(trpc.catalog.products.get.queryOptions({ id: version.productId }));
  const editions = useFormEditions(access.documents.read);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const readOnly = version.status !== "draft" || !access.documents.write;
  const section = search.section ?? "templates";
  const documents = contents.documents;

  const documentFields = useMemo(
    () => [enrichmentSchema(contents.enrichment)],
    [contents.enrichment],
  );

  const productName = product.data?.name ?? "";

  const go = (next: DocumentsSearch) => navigate({ search: next, replace: true });
  const save = (patch: Partial<DocumentSet>) => set("documents", { ...documents, ...patch });

  const template = documents.templates.find((t) => t.key === search.item) ?? documents.templates[0];

  const newTemplateAction = !readOnly && (
    <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
      <Plus /> New template
    </Button>
  );

  return (
    <PageBody>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          label="Documents"
          value={section}
          onValueChange={(next) => go({ section: next })}
          options={[
            { value: "templates", label: "Templates" },
            { value: "clauses", label: "Clauses" },
            { value: "schedule", label: "Schedule" },
          ]}
        />
        {section === "templates" && documents.templates.length > 0 && (
          <div className="flex items-center gap-2">
            <Select value={template?.key} onValueChange={(item) => go({ section, item })}>
              <SelectTrigger size="sm" aria-label="Template" className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {documents.templates.map((t) => (
                  <SelectItem key={t.key} value={t.key}>
                    {t.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {newTemplateAction}
          </div>
        )}
      </div>

      {section === "templates" &&
        (template ? (
          <DocumentFieldsProvider value={documentFields}>
            <TemplateEditor
              key={template.key}
              template={template}
              onChange={(next) =>
                save({
                  templates: documents.templates.map((t) => (t.key === template.key ? next : t)),
                })
              }
              onDelete={() => setDeleting(true)}
              contents={contents}
              productName={productName}
              version={version.version}
              readOnly={readOnly}
              selected={search.block ?? template.blocks[0]?.id}
              onSelect={(block) => go({ section, item: template.key, ...(block && { block }) })}
            />
          </DocumentFieldsProvider>
        ) : (
          <Card>
            <EmptyState
              icon={<LayoutTemplate />}
              title="No templates yet"
              description="Compose declarations, quote proposals and notices from document blocks."
              action={newTemplateAction}
            />
          </Card>
        ))}

      {section === "clauses" && (
        <ClausesEditor
          contents={contents}
          onChange={(clauses) => save({ clauses })}
          readOnly={readOnly}
          selected={search.item}
          onSelect={(item) => go({ section, ...(item && { item }) })}
          productName={productName}
          version={version.version}
        />
      )}

      {section === "schedule" && (
        <ScheduleEditor
          contents={contents}
          onChange={(schedule) => save({ schedule })}
          readOnly={readOnly}
          editions={editions.data ?? []}
          productName={productName}
          version={version.version}
        />
      )}

      <NewTemplateDialog
        open={creating}
        onOpenChange={setCreating}
        onCreate={(title, kind) => {
          const created = blankTemplate(
            title,
            kind,
            documents.templates.map((t) => t.key),
          );

          set("documents", { ...documents, templates: [...documents.templates, created] }, true);
          go({ section: "templates", item: created.key });
        }}
      />
      {template && (
        <ConfirmDialog
          open={deleting}
          onOpenChange={setDeleting}
          title={`Delete ${template.title}`}
          description="Its blocks are deleted and it's taken off the schedule."
          confirmLabel="Delete template"
          onConfirm={() => {
            save({
              templates: documents.templates.filter((t) => t.key !== template.key),
              schedule: documents.schedule.filter(
                (e) => !(e.document.kind === "template" && e.document.key === template.key),
              ),
            });

            go({ section: "templates" });
          }}
        />
      )}
    </PageBody>
  );
}

function NewTemplateDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (title: string, kind: TemplateKind) => void;
}) {
  const id = useId();
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<TemplateKind>("declarations");
  const [submitted, setSubmitted] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);

        if (!next) {
          setTitle("");
          setSubmitted(false);
        }
      }}
    >
      <DialogContent>
        <form
          className="grid gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted(true);

            if (!title.trim()) return;

            onCreate(title.trim(), kind);
            onOpenChange(false);
            setTitle("");
            setSubmitted(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>New template</DialogTitle>
            <DialogDescription>Start with a header, then add blocks.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor={`${id}-title`}>Title</Label>
              <Input
                id={`${id}-title`}
                value={title}
                placeholder="Homeowners declarations"
                aria-invalid={submitted && !title.trim()}
                onChange={(event) => setTitle(event.target.value)}
              />
              {submitted && !title.trim() && (
                <p className="m-0 text-sm text-destructive">Enter a title.</p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${id}-kind`}>Type</Label>
              <Select value={kind} onValueChange={(value) => setKind(value as TemplateKind)}>
                <SelectTrigger id={`${id}-kind`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEMPLATE_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {TEMPLATE_KIND_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit">Create template</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
