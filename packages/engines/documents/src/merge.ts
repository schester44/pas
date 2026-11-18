import {
  canonicalPath,
  getAt,
  indexSchema,
  isField,
  type RiskSchema,
  type SchemaIndex,
} from "@pas/forms-core";
import { contextSchema, type DocumentContext, documentData } from "./context";
import { formatValue } from "./format";

const FIELD = /\{\{([^{}]*)\}\}/g;

export interface MergeField {
  path: string;
  raw: string;
}

export function mergeFields(text: string): MergeField[] {
  return [...text.matchAll(FIELD)].map((match) => ({ path: match[1]!.trim(), raw: match[0] }));
}

export function hasUnclosedField(text: string): boolean {
  const stripped = text.replace(FIELD, "");

  return stripped.includes("{{") || stripped.includes("}}");
}

export interface Resolver {
  data: Record<string, unknown>;
  index: SchemaIndex;
  read: (path: string) => unknown;
  format: (path: string, value?: unknown) => string;
  merge: (text: string) => string;
}

export function createResolver(context: DocumentContext, risk: RiskSchema): Resolver {
  const data = documentData(context);
  const index = indexSchema(contextSchema(risk, "document"));
  const read = (path: string) => getAt(data, path);

  const format = (path: string, value = read(path)) => {
    const node = index.get(canonicalPath(path));

    return formatValue(value, isField(node) ? node : undefined);
  };

  return {
    data,
    index,
    read,
    format,
    merge: (text) => text.replace(FIELD, (_, path: string) => format(path.trim())),
  };
}
