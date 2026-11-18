import type {
  Block,
  BlockType,
  DocumentTemplate,
  ScheduledDocument,
  TemplateKind,
  TransactionType,
} from "@pas/documents";
import type { AdminOutputs } from "@pas/api-client";
import {
  Columns2,
  FileSignature,
  Heading,
  LayoutTemplate,
  ListChecks,
  type LucideIcon,
  MapPin,
  PanelTop,
  Quote,
  ScrollText,
  SeparatorHorizontal,
  ShieldCheck,
  TextQuote,
} from "lucide-react";

export type DocumentSection = "templates" | "clauses" | "schedule";
export type FormEdition = AdminOutputs["documents"]["formEditions"]["list"][number];

export const TEMPLATE_KIND_LABELS: Record<TemplateKind, string> = {
  declarations: "Declarations",
  quote_proposal: "Quote proposal",
  application: "Application",
  binder: "Binder",
  notice: "Notice",
  letter: "Letter",
  other: "Other",
};

export const TRANSACTION_LABELS: Record<TransactionType, string> = {
  quote: "Quote",
  new_business: "New business",
  renewal: "Renewal",
  endorsement: "Endorsement",
  cancellation: "Cancellation",
  reinstatement: "Reinstatement",
  non_renewal: "Nonrenewal",
};

export const BLOCK_META: Record<BlockType, { label: string; icon: LucideIcon; hint: string }> = {
  header: { label: "Header", icon: PanelTop, hint: "Brand, product and document title" },
  heading: { label: "Heading", icon: Heading, hint: "A section title" },
  text: { label: "Text", icon: TextQuote, hint: "Wording with merge fields" },
  keyValue: { label: "Details", icon: Columns2, hint: "Labelled values in one or two columns" },
  coverageSchedule: {
    label: "Coverage schedule",
    icon: ShieldCheck,
    hint: "Selected coverages with limits and deductibles",
  },
  exposureTable: { label: "Exposure table", icon: MapPin, hint: "One row per location, vehicle…" },
  clause: { label: "Clause", icon: ScrollText, hint: "Wording from the clause library" },
  formsSchedule: { label: "Forms schedule", icon: ListChecks, hint: "Forms in this packet" },
  signature: { label: "Signature", icon: FileSignature, hint: "Signature and date lines" },
  notice: { label: "Notice", icon: Quote, hint: "Boxed statutory wording" },
  pageBreak: { label: "Page break", icon: SeparatorHorizontal, hint: "Start a new page" },
};

export const TEMPLATE_ICON = LayoutTemplate;

const firstLine = (text: string) =>
  text
    .split("\n")
    .find((line) => line.trim())
    ?.trim() ?? "";

export function blockSummary(block: Block, clauseTitle?: string): string {
  switch (block.type) {
    case "header":
      return block.title;
    case "heading":
      return block.text;
    case "text":
    case "notice":
      return ("title" in block && block.title) || firstLine(block.body).replace(/\*\*/g, "");
    case "keyValue":
      return block.title || block.rows.map((row) => row.label).join(", ");
    case "coverageSchedule":
    case "formsSchedule":
      return block.title ?? "";
    case "exposureTable":
      return block.title || block.path;
    case "clause":
      return clauseTitle ?? block.clause;
    case "signature":
      return block.role;
    case "pageBreak":
      return "";
  }
}

export function toKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+|_+$/g, "")
    .slice(0, 64);
}

export function uniqueKey(taken: readonly string[], base: string): string {
  const set = new Set(taken);
  const root = base || "item";

  if (!set.has(root)) return root;

  let n = 2;

  while (set.has(`${root}_${n}`)) n++;

  return `${root}_${n}`;
}

export function blankTemplate(
  title: string,
  kind: TemplateKind,
  taken: string[],
): DocumentTemplate {
  return {
    key: uniqueKey(taken, toKey(title)),
    title,
    kind,
    page: { size: "letter", margins: "normal" },
    blocks: [{ id: "header", type: "header", title, subtitle: "Policy {{policy.number}}" }],
  };
}

export function documentTitle(
  document: ScheduledDocument,
  templates: readonly DocumentTemplate[],
  editions: readonly FormEdition[],
): string {
  if (document.kind === "template") {
    return templates.find((t) => t.key === document.key)?.title ?? document.key;
  }

  const edition = editions.find((e) => e.id === document.editionId);

  return edition ? edition.title : "Missing form edition";
}

export const editionCode = (edition: Pick<FormEdition, "formNumber" | "editionLabel">) =>
  `${edition.formNumber} ${edition.editionLabel}`;
