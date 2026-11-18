import {
  BLOCK_TYPES,
  type Block,
  type BlockType,
  type DocumentTemplate,
  type Jurisdiction,
  PAGE_MARGINS,
  TEMPLATE_KINDS,
} from "@pas/documents";
import { Button } from "@pas/ui/components/button";
import { Card } from "@pas/ui/components/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@pas/ui/components/dropdown-menu";
import { Input } from "@pas/ui/components/input";
import { SegmentedControl } from "@pas/ui/components/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pas/ui/components/select";
import { Spinner } from "@pas/ui/components/spinner";
import { jurisdictionCode, jurisdictionName } from "@pas/ui/lib/jurisdictions";
import { cn } from "@pas/ui/lib/utils";
import { ArrowDown, ArrowUp, Copy, ExternalLink, GitBranch, Plus, Trash2 } from "lucide-react";
import { useId, useMemo, useState } from "react";
import {
  Code,
  IconAction,
  InspectorBody,
  InspectorHeader,
  InspectorSection,
  Prop,
  PropRow,
} from "@/components/builders/inspector";
import {
  BLOCK_META,
  blockSummary,
  TEMPLATE_ICON,
  TEMPLATE_KIND_LABELS,
  uniqueKey,
} from "@/components/catalog/documents";
import type { Contents } from "@/components/catalog/version-editor";
import { BlockInspector } from "./block-inspector";
import { PdfPreview } from "./pdf-preview";
import { usePreviewContext, useTemplatePdf } from "./preview";

const MARGIN_LABELS = { narrow: "Narrow", normal: "Normal", wide: "Wide" } as const;
const SETTINGS = "__template";

export function TemplateEditor({
  template,
  onChange,
  onDelete,
  contents,
  productName,
  version,
  readOnly,
  selected,
  onSelect,
}: {
  template: DocumentTemplate;
  onChange: (template: DocumentTemplate) => void;
  onDelete: () => void;
  contents: Contents;
  productName: string;
  version: string;
  readOnly: boolean;
  selected: string | undefined;
  onSelect: (block: string | undefined) => void;
}) {
  const jurisdictions = contents.availability.map((w) => w.jurisdiction);

  const [jurisdiction, setJurisdiction] = useState<Jurisdiction>(
    jurisdictions[0] ?? { country: "US" },
  );

  const scenario = useMemo(
    () => ({ jurisdiction, transaction: "new_business" as const }),
    [jurisdiction],
  );

  const preview = usePreviewContext(contents, productName, version, scenario);
  const pdf = useTemplatePdf(template, preview?.context ?? null, contents);
  const [pages, setPages] = useState<number | null>(null);

  const index = template.blocks.findIndex((block) => block.id === selected);
  const block = template.blocks[index];

  const setBlocks = (blocks: Block[]) => onChange({ ...template, blocks });

  const add = (type: BlockType) => {
    const created = newBlockFor(type, template);
    const at = index >= 0 ? index + 1 : template.blocks.length;
    setBlocks(template.blocks.toSpliced(at, 0, created));
    onSelect(created.id);
  };

  const move = (delta: -1 | 1) => {
    const target = index + delta;

    if (index < 0 || target < 0 || target >= template.blocks.length) return;

    const next = [...template.blocks];
    [next[index], next[target]] = [next[target]!, next[index]!];
    setBlocks(next);
  };

  const duplicate = () => {
    if (!block) return;

    const copy = { ...structuredClone(block), id: uniqueKey(ids(template), `${block.id}_copy`) };
    setBlocks(template.blocks.toSpliced(index + 1, 0, copy));
    onSelect(copy.id);
  };

  const remove = () => {
    const next = template.blocks.filter((_, i) => i !== index);
    setBlocks(next);
    onSelect(next[Math.min(index, next.length - 1)]?.id);
  };

  const openPdf = () => {
    if (!pdf.data) return;

    const url = URL.createObjectURL(
      new Blob([pdf.data as Uint8Array<ArrayBuffer>], { type: "application/pdf" }),
    );

    window.open(url, "_blank", "noopener");
  };

  const clauseTitle = (key: string) => contents.documents.clauses.find((c) => c.key === key)?.title;
  const BlockIcon = block ? BLOCK_META[block.type].icon : TEMPLATE_ICON;

  return (
    <Card className="grid overflow-hidden lg:h-[calc(100dvh-13rem)] lg:min-h-[40rem] lg:grid-cols-[minmax(0,30rem)_minmax(0,1fr)]">
      <div className="flex min-h-0 flex-col border-b lg:border-r lg:border-b-0">
        <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b bg-muted/30 pr-2 pl-4">
          <span className="text-sm font-medium">
            Blocks{" "}
            <span className="text-muted-foreground tabular-nums">{template.blocks.length}</span>
          </span>
          {!readOnly && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost">
                  <Plus /> Add block
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                {BLOCK_TYPES.map((type) => {
                  const meta = BLOCK_META[type];

                  return (
                    <DropdownMenuItem
                      key={type}
                      onSelect={() => add(type)}
                      className="items-start py-2"
                    >
                      <meta.icon className="mt-0.5" />
                      <span className="grid gap-0.5">
                        <span>{meta.label}</span>
                        <span className="text-xs text-muted-foreground">{meta.hint}</span>
                      </span>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ul
            aria-label="Blocks"
            className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-px border-b bg-muted/30 p-1.5"
          >
            <BlockRow
              icon={TEMPLATE_ICON}
              label="Page and type"
              summary={`${TEMPLATE_KIND_LABELS[template.kind]} · ${template.page.size === "a4" ? "A4" : "Letter"}`}
              selected={!block}
              onClick={() => onSelect(SETTINGS)}
            />
            {template.blocks.map((item) => {
              const meta = BLOCK_META[item.type];

              return (
                <BlockRow
                  key={item.id}
                  icon={meta.icon}
                  label={meta.label}
                  summary={blockSummary(
                    item,
                    item.type === "clause" ? clauseTitle(item.clause) : undefined,
                  )}
                  conditional={!!item.showWhen}
                  selected={item.id === block?.id}
                  onClick={() => onSelect(item.id)}
                />
              );
            })}
          </ul>
          <InspectorHeader
            icon={BlockIcon}
            title={block ? BLOCK_META[block.type].label : template.title}
            subtitle={
              block ? <Code className="text-xs text-muted-foreground">{block.id}</Code> : "Template"
            }
            actions={
              !readOnly &&
              (block ? (
                <>
                  <IconAction
                    label="Move up"
                    icon={ArrowUp}
                    onClick={() => move(-1)}
                    disabled={index === 0}
                  />
                  <IconAction
                    label="Move down"
                    icon={ArrowDown}
                    onClick={() => move(1)}
                    disabled={index === template.blocks.length - 1}
                  />
                  <IconAction label="Duplicate" icon={Copy} onClick={duplicate} />
                  <IconAction label="Remove block" icon={Trash2} onClick={remove} />
                </>
              ) : (
                <IconAction label="Delete template" icon={Trash2} onClick={onDelete} />
              ))
            }
          />
          {block ? (
            <BlockInspector
              key={block.id}
              block={block}
              onChange={(next) =>
                setBlocks(template.blocks.map((b, i) => (i === index ? next : b)))
              }
              schema={contents.riskSchema}
              clauses={contents.documents.clauses}
              readOnly={readOnly}
            />
          ) : (
            <TemplateSettings template={template} onChange={onChange} readOnly={readOnly} />
          )}
        </div>
      </div>
      <div className="flex min-h-[32rem] min-w-0 flex-col">
        <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
          <span className="flex items-center gap-2 text-sm font-medium">
            Preview
            <span className="font-normal text-muted-foreground tabular-nums">
              {pages ? `${pages} ${pages === 1 ? "page" : "pages"} · sample data` : "Sample data"}
            </span>
            {pdf.rendering && <Spinner className="size-3.5 text-muted-foreground" />}
          </span>
          <div className="flex items-center gap-2">
            {jurisdictions.length > 0 && (
              <Select
                value={jurisdictionCode(jurisdiction)}
                onValueChange={(code) =>
                  setJurisdiction(jurisdictions.find((j) => jurisdictionCode(j) === code)!)
                }
              >
                <SelectTrigger size="sm" aria-label="Preview jurisdiction" className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  {jurisdictions.map((j) => (
                    <SelectItem key={jurisdictionCode(j)} value={jurisdictionCode(j)}>
                      {jurisdictionName(j)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button size="sm" variant="outline" onClick={openPdf} disabled={!pdf.data}>
              <ExternalLink /> Open PDF
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto bg-muted/40 px-6 py-6">
          {pdf.error && (
            <p className="m-0 mx-auto mb-4 max-w-[44rem] text-sm text-destructive">
              Couldn't render the preview. {pdf.error}
            </p>
          )}
          <PdfPreview
            data={pdf.data}
            label={template.title}
            onRendered={setPages}
            className="mx-auto max-w-[44rem]"
          />
        </div>
      </div>
    </Card>
  );
}

const ids = (template: DocumentTemplate) => template.blocks.map((block) => block.id);

function newBlockFor(type: BlockType, template: DocumentTemplate): Block {
  const id = uniqueKey(
    ids(template),
    type.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`),
  );

  switch (type) {
    case "header":
      return { id, type, title: template.title, subtitle: "Policy {{policy.number}}" };
    case "heading":
      return { id, type, text: "New section" };
    case "text":
      return { id, type, body: "" };
    case "keyValue":
      return {
        id,
        type,
        columns: 2,
        rows: [{ label: "Named insured", value: "{{namedInsured.name}}" }],
      };
    case "coverageSchedule":
      return { id, type, title: "Coverages", limit: true, deductible: true, premium: true };
    case "exposureTable":
      return { id, type, path: "", columns: [] };
    case "clause":
      return { id, type, clause: "" };
    case "formsSchedule":
      return { id, type, title: "Forms and endorsements" };
    case "signature":
      return { id, type, role: "Authorized representative", date: true };
    case "notice":
      return { id, type, title: "Important notice", body: "" };
    case "pageBreak":
      return { id, type };
  }
}

function BlockRow({
  icon: Icon,
  label,
  summary,
  conditional,
  selected,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  summary: string;
  conditional?: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-current={selected || undefined}
        onClick={onClick}
        className={cn(
          "flex h-9 w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
          selected ? "bg-primary/[0.07] text-foreground" : "hover:bg-muted/70",
        )}
      >
        <Icon
          className={cn("size-4 shrink-0", selected ? "text-primary" : "text-muted-foreground")}
        />
        <span className="shrink-0 font-medium">{label}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{summary}</span>
        {conditional && (
          <GitBranch
            aria-label="Shown conditionally"
            className="size-3.5 shrink-0 text-muted-foreground"
          />
        )}
      </button>
    </li>
  );
}

function TemplateSettings({
  template,
  onChange,
  readOnly,
}: {
  template: DocumentTemplate;
  onChange: (template: DocumentTemplate) => void;
  readOnly: boolean;
}) {
  const id = useId();

  if (readOnly) {
    return (
      <InspectorBody>
        <InspectorSection title="Template" readOnly>
          <Prop readOnly label="Title" value={template.title} />
          <Prop readOnly label="Key" value={<Code>{template.key}</Code>} />
          <Prop readOnly label="Type" value={TEMPLATE_KIND_LABELS[template.kind]} />
          <Prop readOnly label="Paper" value={template.page.size === "a4" ? "A4" : "US Letter"} />
          <Prop readOnly label="Margins" value={MARGIN_LABELS[template.page.margins]} />
        </InspectorSection>
      </InspectorBody>
    );
  }

  return (
    <InspectorBody>
      <InspectorSection title="Template">
        <Prop label="Title" htmlFor={`${id}-title`}>
          <Input
            id={`${id}-title`}
            value={template.title}
            onChange={(event) => onChange({ ...template, title: event.target.value })}
          />
        </Prop>
        <PropRow>
          <Prop label="Type" htmlFor={`${id}-kind`}>
            <Select
              value={template.kind}
              onValueChange={(kind) =>
                onChange({ ...template, kind: kind as DocumentTemplate["kind"] })
              }
            >
              <SelectTrigger id={`${id}-kind`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TEMPLATE_KINDS.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {TEMPLATE_KIND_LABELS[kind]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Prop>
          <Prop label="Key" hint="How the schedule refers to it.">
            <Input value={template.key} disabled className="font-mono text-[0.8125rem]" />
          </Prop>
        </PropRow>
      </InspectorSection>
      <InspectorSection title="Page">
        <Prop label="Paper">
          <SegmentedControl
            label="Paper"
            value={template.page.size}
            onValueChange={(size) => onChange({ ...template, page: { ...template.page, size } })}
            options={[
              { value: "letter", label: "US Letter" },
              { value: "a4", label: "A4" },
            ]}
          />
        </Prop>
        <Prop label="Margins">
          <SegmentedControl
            label="Margins"
            value={template.page.margins}
            onValueChange={(margins) =>
              onChange({ ...template, page: { ...template.page, margins } })
            }
            options={PAGE_MARGINS.map((value) => ({ value, label: MARGIN_LABELS[value] }))}
          />
        </Prop>
      </InspectorSection>
    </InspectorBody>
  );
}
