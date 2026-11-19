import { referencedPaths } from "@pas/expressions";
import {
  canonicalPath,
  indexSchema,
  type RiskSchema,
  resolvesInSchema,
  type SchemaIndex,
} from "@pas/forms-core";
import { contextSchema, type CoverageLike } from "./context";
import { hasUnclosedField, mergeFields } from "./merge";
import type { Block, DocumentSet, DocumentTemplate } from "./model";
import { documentRef } from "./schedule";

export type DocumentTarget =
  | { section: "templates"; template: string; block?: string; property?: string }
  | { section: "clauses"; clause: string; variant?: number }
  | { section: "schedule"; entry: string; property?: string };

export interface DocumentIssue {
  severity: "error" | "warning";
  message: string;
  params?: Record<string, { kind: "jurisdiction"; code: string }>;
  target: DocumentTarget;
}

export interface CheckOptions {
  formEditions?: ReadonlySet<string>;
}

const KEY = /^[a-z][a-z0-9_]*$/;
const JURISDICTION = /^[A-Z]{2}(-[A-Z0-9]{1,3})?$/;

class Checker {
  readonly issues: DocumentIssue[] = [];
  readonly document: SchemaIndex;
  readonly schedule: SchemaIndex;
  readonly risk: SchemaIndex;

  constructor(schema: RiskSchema) {
    this.document = indexSchema(contextSchema(schema, "document"));
    this.schedule = indexSchema(contextSchema(schema, "schedule"));
    this.risk = indexSchema(schema);
  }

  error(target: DocumentTarget, message: string, params?: DocumentIssue["params"]) {
    this.issues.push({ severity: "error", target, message, ...(params && { params }) });
  }

  warn(target: DocumentTarget, message: string) {
    this.issues.push({ severity: "warning", target, message });
  }

  merge(target: DocumentTarget, text: string | undefined) {
    if (!text) return;

    if (hasUnclosedField(text)) this.error(target, "A merge field is missing {{ or }}");

    for (const field of mergeFields(text)) {
      if (!field.path) this.error(target, "A merge field is empty");
      else if (!resolvesInSchema(this.document, canonicalPath(field.path))) {
        this.error(target, `Merge field ${field.path} doesn't resolve`);
      }
    }
  }

  expression(target: DocumentTarget, expression: string | undefined, index: SchemaIndex) {
    if (!expression?.trim()) return;

    let paths: string[];

    try {
      paths = referencedPaths(expression);
    } catch (error) {
      this.error(target, (error as Error).message);

      return;
    }

    for (const path of paths) {
      if (!resolvesInSchema(index, path)) this.error(target, `Unknown path ${path}`);
    }
  }
}

function checkBlock(checker: Checker, set: DocumentSet, template: string, block: Block) {
  const at = (property?: string): DocumentTarget => ({
    section: "templates",
    template,
    block: block.id,
    ...(property && { property }),
  });

  checker.expression(at("showWhen"), block.showWhen, checker.document);

  switch (block.type) {
    case "header":
      checker.merge(at("title"), block.title);
      checker.merge(at("subtitle"), block.subtitle);
      break;
    case "heading":
      checker.merge(at("text"), block.text);
      break;
    case "text":
      checker.merge(at("body"), block.body);
      break;
    case "notice":
      checker.merge(at("title"), block.title);
      checker.merge(at("body"), block.body);
      break;
    case "signature":
      checker.merge(at("name"), block.name);
      break;
    case "keyValue":
      if (block.rows.length === 0) checker.warn(at("rows"), "Add at least one row");

      block.rows.forEach((row, i) => checker.merge(at(`rows[${i}]`), row.value));
      break;
    case "exposureTable": {
      const node = checker.risk.get(block.path);

      if (!node) checker.error(at("path"), `Unknown path ${block.path}`);
      else if (node.kind !== "repeatable" || block.path.includes("[]")) {
        checker.error(at("path"), `${block.path} isn't a top-level repeatable`);
      } else {
        block.columns.forEach((column, i) => {
          if (!resolvesInSchema(checker.risk, `${block.path}[].${column.path}`)) {
            checker.error(at(`columns[${i}]`), `Unknown path ${block.path}[].${column.path}`);
          }
        });
      }

      if (block.columns.length === 0) checker.warn(at("columns"), "Add at least one column");

      break;
    }
    case "clause":
      if (!set.clauses.some((clause) => clause.key === block.clause)) {
        checker.error(at("clause"), `Clause ${block.clause || "(none)"} isn't in the library`);
      }

      break;
    default:
      break;
  }
}

function checkTemplate(checker: Checker, set: DocumentSet, template: DocumentTemplate) {
  const at: DocumentTarget = { section: "templates", template: template.key };

  if (!KEY.test(template.key)) {
    checker.error(at, "Use lowercase letters, digits and _ for the template key");
  }

  if (!template.title.trim()) checker.error(at, "Give this template a title");

  if (template.blocks.length === 0) checker.warn(at, "This template has no blocks");

  const ids = new Set<string>();

  for (const block of template.blocks) {
    if (ids.has(block.id)) {
      checker.error({ ...at, block: block.id }, `Block id ${block.id} is used twice`);
    }

    ids.add(block.id);
    checkBlock(checker, set, template.key, block);
  }
}

/** Static references in a version's documents: merge fields, paths, clauses, templates, forms. */
export function checkDocuments(
  schema: RiskSchema,
  coverages: readonly CoverageLike[],
  set: DocumentSet,
  options: CheckOptions = {},
): DocumentIssue[] {
  const checker = new Checker(schema);
  const templateKeys = new Set<string>();
  const clauseKeys = new Set<string>();

  for (const template of set.templates) {
    if (templateKeys.has(template.key)) {
      checker.error(
        { section: "templates", template: template.key },
        `Template key ${template.key} is used twice`,
      );
    }

    templateKeys.add(template.key);
    checkTemplate(checker, set, template);
  }

  const usesCoverages = set.templates.some((t) =>
    t.blocks.some((b) => b.type === "coverageSchedule"),
  );

  if (usesCoverages && coverages.length === 0) {
    const template = set.templates.find((t) =>
      t.blocks.some((b) => b.type === "coverageSchedule"),
    )!;

    checker.warn(
      { section: "templates", template: template.key },
      "The coverage schedule is empty until this version has coverages",
    );
  }

  for (const clause of set.clauses) {
    const at = { section: "clauses" as const, clause: clause.key };

    if (!KEY.test(clause.key))
      checker.error(at, "Use lowercase letters, digits and _ for the clause key");
    else if (clauseKeys.has(clause.key))
      checker.error(at, `Clause key ${clause.key} is used twice`);

    clauseKeys.add(clause.key);

    if (!clause.title.trim()) checker.error(at, "Give this clause a title");

    if (!clause.body.trim()) checker.error(at, "Add the default wording");

    checker.merge(at, clause.body);
    const claimed = new Set<string>();

    clause.variants.forEach((variant, i) => {
      const target = { ...at, variant: i };

      if (variant.jurisdictions.length === 0)
        checker.error(target, "Choose where this variant applies");

      for (const code of variant.jurisdictions) {
        if (!JURISDICTION.test(code)) checker.error(target, `${code} isn't a jurisdiction code`);
        else if (claimed.has(code)) {
          checker.error(target, "{jurisdiction} already has a variant", {
            jurisdiction: { kind: "jurisdiction", code },
          });
        }

        claimed.add(code);
      }

      if (!variant.body.trim()) checker.error(target, "Add the wording for this variant");

      checker.merge(target, variant.body);
    });
  }

  const unconditional = new Map<string, Set<string>>();

  for (const entry of set.schedule) {
    const at = (property?: string): DocumentTarget => ({
      section: "schedule",
      entry: entry.id,
      ...(property && { property }),
    });

    const document = entry.document;

    if (document.kind === "template" && !templateKeys.has(document.key)) {
      checker.error(at("document"), `Template ${document.key || "(none)"} doesn't exist`);
    }

    if (
      document.kind === "form" &&
      options.formEditions &&
      !options.formEditions.has(document.editionId)
    ) {
      checker.error(at("document"), "This form edition isn't in the forms library");
    }

    if (entry.attachTo.length === 0)
      checker.error(at("attachTo"), "Choose when this document applies");

    checker.expression(at("includeWhen"), entry.includeWhen, checker.schedule);

    if (entry.includeWhen?.trim()) continue;

    const ref = documentRef(document);
    const prior = unconditional.get(ref) ?? new Set<string>();

    if (entry.attachTo.some((transaction) => prior.has(transaction))) {
      checker.warn(at("document"), "This document is scheduled twice");
    }

    unconditional.set(ref, new Set([...prior, ...entry.attachTo]));
  }

  return checker.issues;
}
