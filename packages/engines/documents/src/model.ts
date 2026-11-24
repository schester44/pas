import { z } from "zod";

export const TEMPLATE_KINDS = [
  "declarations",
  "quote_proposal",
  "application",
  "binder",
  "notice",
  "letter",
  "enrichment_report",
  "other",
] as const;

export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export const TRANSACTION_TYPES = [
  "quote",
  "new_business",
  "renewal",
  "endorsement",
  "cancellation",
  "reinstatement",
  "non_renewal",
] as const;

export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const BLOCK_TYPES = [
  "header",
  "heading",
  "text",
  "keyValue",
  "coverageSchedule",
  "exposureTable",
  "dataTable",
  "clause",
  "formsSchedule",
  "signature",
  "notice",
  "pageBreak",
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

interface BlockBase {
  id: string;
  showWhen?: string;
}

export interface HeaderBlock extends BlockBase {
  type: "header";
  title: string;
  subtitle?: string;
}

export interface HeadingBlock extends BlockBase {
  type: "heading";
  text: string;
}

export interface TextBlock extends BlockBase {
  type: "text";
  body: string;
}

export interface KeyValueRow {
  label: string;
  value: string;
}

export interface KeyValueBlock extends BlockBase {
  type: "keyValue";
  title?: string;
  columns: 1 | 2;
  rows: KeyValueRow[];
}

export interface CoverageScheduleBlock extends BlockBase {
  type: "coverageSchedule";
  title?: string;
  limit: boolean;
  deductible: boolean;
  premium: boolean;
}

export interface ExposureColumn {
  label: string;
  path: string;
}

export interface ExposureTableBlock extends BlockBase {
  type: "exposureTable";
  title?: string;
  path: string;
  columns: ExposureColumn[];
}

/** Rows from any list in the context (an enrichment cost breakdown), with an optional total. */
export interface DataTableBlock extends BlockBase {
  type: "dataTable";
  title?: string;
  path: string;
  columns: ExposureColumn[];
  /** A unary expression over each row (`$`); rows where it's false are left out. */
  rowWhen?: string;
  total?: { label: string; path: string };
}

export interface ClauseBlock extends BlockBase {
  type: "clause";
  clause: string;
}

export interface FormsScheduleBlock extends BlockBase {
  type: "formsSchedule";
  title?: string;
}

export interface SignatureBlock extends BlockBase {
  type: "signature";
  role: string;
  name?: string;
  date: boolean;
}

export interface NoticeBlock extends BlockBase {
  type: "notice";
  title?: string;
  body: string;
}

export interface PageBreakBlock extends BlockBase {
  type: "pageBreak";
}

export type Block =
  | HeaderBlock
  | HeadingBlock
  | TextBlock
  | KeyValueBlock
  | CoverageScheduleBlock
  | ExposureTableBlock
  | DataTableBlock
  | ClauseBlock
  | FormsScheduleBlock
  | SignatureBlock
  | NoticeBlock
  | PageBreakBlock;

export const PAGE_SIZES = ["letter", "a4"] as const;
export const PAGE_MARGINS = ["narrow", "normal", "wide"] as const;

export interface PageSettings {
  size: (typeof PAGE_SIZES)[number];
  margins: (typeof PAGE_MARGINS)[number];
}

export interface DocumentTemplate {
  key: string;
  title: string;
  kind: TemplateKind;
  page: PageSettings;
  blocks: Block[];
}

export interface ClauseVariant {
  jurisdictions: string[];
  title?: string;
  body: string;
}

export interface Clause {
  key: string;
  title: string;
  body: string;
  variants: ClauseVariant[];
}

export type ScheduledDocument =
  | { kind: "template"; key: string }
  | { kind: "form"; editionId: string };

export interface ScheduleEntry {
  id: string;
  document: ScheduledDocument;
  attachTo: TransactionType[];
  includeWhen?: string;
  order: number;
}

export interface DocumentSet {
  templates: DocumentTemplate[];
  clauses: Clause[];
  schedule: ScheduleEntry[];
}

export const emptyDocumentSet = (): DocumentSet => ({ templates: [], clauses: [], schedule: [] });

const text = (max: number) => z.string().max(max);
const optionalExpression = z.string().max(2000).optional();
const blockId = z.string().min(1).max(64);
const base = { id: blockId, showWhen: optionalExpression };

const blockSchema = z.discriminatedUnion("type", [
  z.object({
    ...base,
    type: z.literal("header"),
    title: text(200),
    subtitle: text(300).optional(),
  }),
  z.object({ ...base, type: z.literal("heading"), text: text(200) }),
  z.object({ ...base, type: z.literal("text"), body: text(20_000) }),
  z.object({
    ...base,
    type: z.literal("keyValue"),
    title: text(200).optional(),
    columns: z.union([z.literal(1), z.literal(2)]),
    rows: z.array(z.object({ label: text(200), value: text(1000) })).max(100),
  }),
  z.object({
    ...base,
    type: z.literal("coverageSchedule"),
    title: text(200).optional(),
    limit: z.boolean(),
    deductible: z.boolean(),
    premium: z.boolean(),
  }),
  z.object({
    ...base,
    type: z.literal("exposureTable"),
    title: text(200).optional(),
    path: text(500),
    columns: z.array(z.object({ label: text(200), path: text(500) })).max(12),
  }),
  z.object({
    ...base,
    type: z.literal("dataTable"),
    title: text(200).optional(),
    path: text(500),
    columns: z.array(z.object({ label: text(200), path: text(500) })).max(12),
    rowWhen: optionalExpression,
    total: z.object({ label: text(200), path: text(500) }).optional(),
  }),
  z.object({ ...base, type: z.literal("clause"), clause: text(64) }),
  z.object({ ...base, type: z.literal("formsSchedule"), title: text(200).optional() }),
  z.object({
    ...base,
    type: z.literal("signature"),
    role: text(200),
    name: text(300).optional(),
    date: z.boolean(),
  }),
  z.object({ ...base, type: z.literal("notice"), title: text(200).optional(), body: text(10_000) }),
  z.object({ ...base, type: z.literal("pageBreak") }),
]);

export const documentSetSchema: z.ZodType<DocumentSet> = z.object({
  templates: z
    .array(
      z.object({
        key: text(64),
        title: text(200),
        kind: z.enum(TEMPLATE_KINDS),
        page: z.object({ size: z.enum(PAGE_SIZES), margins: z.enum(PAGE_MARGINS) }),
        blocks: z.array(blockSchema).max(300),
      }),
    )
    .max(100),
  clauses: z
    .array(
      z.object({
        key: text(64),
        title: text(200),
        body: text(20_000),
        variants: z
          .array(
            z.object({
              jurisdictions: z.array(text(10)).max(80),
              title: text(200).optional(),
              body: text(20_000),
            }),
          )
          .max(80),
      }),
    )
    .max(300),
  schedule: z
    .array(
      z.object({
        id: blockId,
        document: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("template"), key: text(64) }),
          z.object({ kind: z.literal("form"), editionId: z.uuid() }),
        ]),
        attachTo: z.array(z.enum(TRANSACTION_TYPES)).max(TRANSACTION_TYPES.length),
        includeWhen: optionalExpression,
        order: z.number().int().min(0).max(10_000),
      }),
    )
    .max(500),
});
